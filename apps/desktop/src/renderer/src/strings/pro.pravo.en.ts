/**
 * „Pravo i pravna praksa" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.ts`.
 *
 * **A unit is copy, not a constant**, and a currency amount in this pack
 * carries none — every tool works in „the currency the user typed the amount
 * in" and never assumes dinars unless the tool is explicitly about dinars
 * (`iznos-slovima`'s built-in wording).
 *
 * **Nothing here judges.** Several tools in this pack are `legal-procedure`:
 * their copy reports days, dates and amounts, and never what a party is
 * entitled to — the core module's own output specification says so, and the
 * copy here says no more than that.
 */
export const PRO_PRAVO_EN = {
  "anuitet-otplatni-plan": {
    principal: "Principal",
    rate: "Nominal annual interest rate",
    rateHint: "Contractual or statutory rate, in percent. Neagle offers no value.",
    instalments: "Number of instalments",
    paymentsPerYear: "Instalments per year",
    freqMonthly: "12 (monthly)",
    freqQuarterly: "4 (quarterly)",
    freqSemiannual: "2 (semi-annual)",
    freqAnnual: "1 (annual)",
    conversion: "Rate conversion",
    conversionProportional: "Proportional (i = p/m)",
    conversionConformal: "Conformal (i = (1+p)^(1/m) − 1)",
    dueTiming: "Instalment due",
    dueTimingHint: "Whether the instalment falls due at the end or the start of the accounting period.",
    dueEnd: "At the end of the period",
    dueStart: "At the start of the period",
    firstDate: "First instalment date",
    dateHint: "Format YYYY-MM-DD. Leave empty if the plan date is not needed.",
    noDate: "not entered",

    results: "Result",
    periodicRate: "Periodic rate (decimal)",
    instalment: "Annuity amount",
    totalPaid: "Total paid",
    totalInterest: "Total interest",
    lastAdjustment: "Adjustment of the last instalment",

    notice: "Rounding note",
    noticeRow: "The first row in which it appears",
    noticeExact: "Exact annuity (6 decimals)",
    noticeShortfall: "Difference from the interest on the balance (6 decimals)",
    noticeNote:
      "Rounding to 2 decimals does not show the remainder the debt actually repays. The debt is still repaid — the two rounded numbers merely coincided.",

    colIndex: "#",
    colDate: "Date",
    colInterest: "Interest",
    colPrincipal: "Principal repayment",
    colInstalment: "Annuity",
    colBalance: "Remaining balance",

    inputs: "Entered",
    formula:
      "i > 0: A = P·i / (1 − (1+i)^(−n))     i = 0: A = P/n     last instalment = remaining balance + interest",

    errorPrincipal: "The principal must be greater than zero, at most 10^12.",
    errorRate: "The nominal rate must be between −99% and 1000%.",
    errorInstalments: "The number of instalments is a whole number from 1 to 1200.",
    errorFirstDate: "The first instalment date is not a valid calendar date.",
    errorGeneral: "The entered data do not give a valid repayment schedule.",
  },

  "iznos-slovima": {
    amount: "Amount",
    amountHint: "Whole part and decimals separated by a comma or dot, e.g. 1234.56.",
    currency: "Currency",
    currencyDinar: "Dinar/para (built-in forms)",
    currencyCustom: "Custom",
    mainUnitTitle: "Forms of the main unit",
    subUnitTitle: "Forms of the subunit",
    unitOne: "Singular (1)",
    unitFew: "Paucal (2, 3, 4)",
    unitMany: "Plural (5 and more, and 11–14)",
    unitGender: "Gender",
    genderM: "Masculine",
    genderF: "Feminine",
    subUnitsPerUnit: "Subunits per unit",
    subUnitsPerUnitHint:
      "The number of subunits in one main unit — 100 for a currency with two decimal places, 0 if the currency has no subunit. It must be a power of ten.",
    style: "Notation",
    styleSpaced: "Separated by words",
    styleJoined: "Joined, without spaces",
    capitalise: "Capital first letter",
    yes: "Yes",
    no: "No",

    results: "Result",
    words: "Amount in words",
    wholeUnits: "Whole units (exact number)",
    subUnits: "Subunit",
    typedAmount: "Typed amount",
    convertedAmount: "Converted amount",
    rounded: "The typed figure was rounded",
    subUnitFraction: "Subunit as a fraction",

    inputs: "Entered",
    formula:
      "class(n): o=1 ∧ t≠11 → singular; o∈{2,3,4} ∧ t∉{12,13,14} → paucal; otherwise plural (t = n mod 100, o = n mod 10); the thousands group = 1 → “thousand”; a zero group is skipped with its scale",

    errorAmount:
      "The amount must be a non-negative number with at most 8 decimals and a whole part up to 999 999 999 999 999.",
    errorMainUnit: "For a custom currency enter all three forms of the main unit.",
    errorSubUnitsPerUnit: "The subunits per unit must be 0 or a power of ten.",
    errorSubUnit: "For a custom currency with a subunit enter all three forms of the subunit.",
  },

  "jmbg-provera": {
    digitsInput: "JMBG",
    digitsHint:
      "13 digits to check, or 12 digits to calculate the check digit. Spaces, hyphens and dots are removed before processing.",
    mode: "Mode",
    modeCheck: "Check 13 digits",
    modeCompute: "Calculate the check digit from 12",
    yes: "Yes",
    no: "No",
    notApplicable: "not applicable in this mode",

    results: "Result",
    weightedSum: "Weighted sum s",
    remainder: "s mod 11",
    m: "m = 11 − (s mod 11)",
    checkDigit: "Calculated check digit",
    matches: "The check digit matches the entered one",
    matchesNote:
      "A matching check digit means only that the record agrees with its own check arithmetic — not that the number was ever issued, or to whom.",
    digits: "Full thirteen-digit record",

    dateTitle: "Date from the record",
    date: "Date",
    dateExists: "The date exists",
    weekday: "Day of the week",
    weekday1: "Monday",
    weekday2: "Tuesday",
    weekday3: "Wednesday",
    weekday4: "Thursday",
    weekday5: "Friday",
    weekday6: "Saturday",
    weekday7: "Sunday",
    centuryRule: "The century is derived by the rule",
    centuryPast: "YYY ≥ 800 → 1000 + YYY",
    centuryPresent: "YYY < 800 → 2000 + YYY",
    centuryNote:
      "Turning a three-digit year into a record is a convention, not data from the record — with a low YYY the derived year may fall in the future.",

    otherTitle: "Other elements of the record",
    region: "Registry number (RR)",
    sequence: "Serial number (BBB)",
    sexRange: "Range of the serial number",
    sexRangeMale: "male (BBB ≤ 499)",
    sexRangeFemale: "female (BBB ≥ 500)",

    inputs: "Entered",
    formula:
      "s = Σ weight·digit (weights 7,6,5,4,3,2 twice over the first 12 digits)     m = 11 − (s mod 11)     K = m if 1 ≤ m ≤ 9, otherwise 0",

    errorDigits: "The input must have exactly 13 (or 12) digits, after removing spaces and hyphens.",
  },

  "katastarska-povrsina": {
    direction: "Direction",
    directionToParts: "m² → ha/a/m²",
    directionToSquareMetres: "ha/a/m² → m²",
    squareMetres: "Area in m²",
    hectares: "Hectares (whole number)",
    ares: "Ares (whole number)",
    remainder: "Remainder in m²",

    results: "Result",
    composed: "Encoding",
    total: "Total in m²",
    unitHa: "ha",
    unitA: "a",
    unitM2: "m²",
    wasNormalisedNote:
      "The entered record was not normalised (ares over 99 or a remainder over 100 m²) — the record shown is the normalised form of the same area.",
    roundedNote: "The entered value had more than 4 decimals and was rounded to 4 decimals.",

    inputs: "Entered",
    formula:
      "T = round(m² · 10000) [ten-thousandths of m²]     ha = floor(T / 10⁸)     a = floor((T mod 10⁸) / 10⁶)     remainder = (T mod 10⁸) mod 10⁶",

    errorSquareMetres: "The area in m² must be from 0 to 10^10, at most 4 decimals.",
    errorHectares: "The number of hectares is a whole number from 0 to 10^6.",
    errorAres: "The number of ares is a whole number of 0 or more.",
    errorRemainder: "The remainder in m² may not be negative.",
  },

  "kazna-i-pritvor": {
    startDate: "Start date",
    dateHint: "Format YYYY-MM-DD.",
    years: "Sentence — years",
    months: "Sentence — months",
    days: "Sentence — days",
    creditedDays: "Days of deprivation of liberty deducted",
    creditedDaysHint: "The number of days counted towards the sentence.",
    creditRatio: "Credit ratio",
    creditRatioHint:
      "How many days of the sentence one day of deprivation of liberty removes. From the regulation you apply — Neagle does not know which regulation that is and offers no value.",
    countFirstDay: "Count the first day",
    countFirstDayHint: "A counting convention, not a regulation — chosen explicitly.",
    fracNum: "Fraction to check — numerator",
    fractionHint:
      "The part of the duration being checked, e.g. 1/2 or 2/3. Leave empty if not needed.",
    fracDen: "Fraction to check — denominator",
    fraction: "Fraction to check",
    noFraction: "not entered",
    yes: "Yes",
    no: "No",

    results: "Result",
    endDate: "Calendar end of the duration (before the counting convention)",
    lastDay: "Last day before deduction",
    totalDays: "Total days",
    exactCredit: "Exact product of the credited days and the ratio",
    creditedDaysApplied: "Days deducted (rounded down)",
    coversWholeTerm: "The entered days cover the whole duration — the date before deduction is not shown.",
    dateAfterCredit: "Last day after deduction",
    fractionTitle: "Fraction of the duration",
    fractionDays: "Days the fraction carries",
    fractionDate: "The date the fraction falls on",
    remainingDays: "Days remaining from that date to the end",
    weekday1: "Monday",
    weekday2: "Tuesday",
    weekday3: "Wednesday",
    weekday4: "Thursday",
    weekday5: "Friday",
    weekday6: "Saturday",
    weekday7: "Sunday",

    inputs: "Entered",
    formula:
      "end = start + (years·12 + months) months + days     last day = end − (countFirstDay ? 1 : 0)     deducted = floor(creditedDays · ratio)     daysForPart = ceil(total · numerator / denominator)",

    errorStartDate: "The start date is not a valid calendar date.",
    errorYears: "The number of years is a whole number from 0 to 100.",
    errorMonths: "The number of months is a whole number from 0 to 1200.",
    errorDays: "The number of days is a whole number from 0 to 36500.",
    errorCreditedDays: "The credited days are a whole number, 0 or more.",
    errorCreditRatio: "The credit ratio must be greater than zero.",
    errorFraction: "The fraction must have a numerator ≥ 0, a denominator > 0, and may not be greater than 1.",
  },

  "nominalna-efektivna-stopa": {
    direction: "Direction",
    directionNominalToEffective: "Nominal → effective",
    directionEffectiveToNominal: "Effective → nominal",
    directionEffectiveToPeriodic: "Effective → periodic",
    directionNominalToNominal: "Nominal at m₁ → nominal at m₂",
    ratePercent: "Annual rate",
    rateHint: "In percent, from −99 to 1000.",
    compoundings: "Number of compounds per year (m)",
    targetCompoundings: "Target number of compounds per year (m₂)",

    results: "Result",
    resultPercent: "Required rate",
    periodicProportional: "Periodic rate (p/m)",
    periodicConformal: "Periodic rate (conformal)",
    periodicPercent: "Periodic rate",
    effectivePercent: "Effective annual rate",
    growthFactor: "Growth factor for one year",
    continuousPercent: "Limit under continuous compounding",
    continuousNote:
      "This is the m → ∞ limit, not a separate mode — no finite number of compounds reaches it.",

    inputs: "Entered",
    formula:
      "nominal→effective: e = (1+p/m)^m − 1     effective→nominal: p = m·((1+e)^(1/m) − 1)     effective→periodic: iₚ = (1+e)^(1/m) − 1",

    errorRate: "The annual rate must be between −99% and 1000%.",
    errorCompoundings: "The number of compounds per year is a whole number from 1 to 366.",
    errorTargetCompoundings: "The target number of compounds per year is a whole number from 1 to 366.",
  },

  "obracun-kamate": {
    principal: "Principal",
    rates: "Periods and rates",
    ratesHint:
      "One row per period, in the form YYYY-MM-DD; rate — the date from which the rate applies and the annual rate in percent. No rate is built in, all are your input.",
    from: "Date from",
    to: "Date to",
    dateHint: "Format YYYY-MM-DD.",
    method: "Method",
    methodConformal: "Conformal",
    methodProportional: "Proportional",
    dayBasis: "Day basis",
    dayBasis365: "365",
    dayBasis366: "366",
    dayBasisActual: "Actual (365 or 366 per year)",
    capitalisation: "Compounding",
    capitalisationNone: "No",
    capitalisationAnnual: "Annual",
    capBoundary: "Compounding boundary",
    capBoundaryCalendar: "Calendar year",
    capBoundaryAnniversary: "Anniversary of the date from",
    includeLastDay: "Include the last day",
    yes: "Yes",
    no: "No",

    results: "Result",
    totalInterest: "Total interest",
    principalPlusInterest: "Principal + interest",
    totalDays: "Total days",
    ignoredRows: "Ignored rate rows (after the date to)",

    colFrom: "From",
    colTo: "To",
    colDays: "Days",
    colRate: "Rate",
    colBasis: "Base",
    colBalance: "Balance",
    colInterest: "Interest",
    colYear: "Year",

    yearlyTitle: "Interest per calendar year",

    inputs: "Entered",
    formula:
      "conformal: I = P·((1+p)^(d/B) − 1)     proportional: I = P·p·d/B     (p = annual rate/100, d = days in the segment, B = day basis)",

    errorPrincipal: "The principal must be greater than zero, at most 10^12.",
    errorFrom: "The date from is not a valid calendar date.",
    errorTo: "The date to is not a valid calendar date, and must be after the date from.",
    errorRates:
      "Rate rows must have a valid date and a rate from −99% to 1000%; the first row must start on or before the date from.",
    errorDayBasis: "The day basis was not recognised.",
    errorCapBoundary: "For annual compounding choose the compounding boundary.",
  },

  "podela-iznosa": {
    totalAmount: "Total amount",
    weights: "Shares",
    weightsHint:
      "One weight per line — a whole number, a fraction n/d (e.g. 1/3), or a percentage (e.g. 25%). The notations may be mixed.",
    smallestUnit: "Smallest unit",
    unit001: "0.01",
    unit1: "1",
    unit100: "100",
    remainderRule: "Remainder allocation",
    ruleLargestRemainder: "Largest remainder (Hamilton)",
    ruleFirstFirst: "In order from the first",
    yes: "Yes",
    no: "No",

    results: "Result",
    share: "Party",
    colIndex: "#",
    colUnits: "Unit",
    colAmount: "Amount",
    colExact: "Exact share (unrounded)",
    colRemainder: "Allocated remainder unit",
    colDeviation: "Deviation from the exact share",
    checksum: "Check sum",
    total: "Allocated total (N × unit)",
    totalAmountEntered: "Typed total amount",
    roundingDifference: "Difference (allocated − typed)",
    remainderUnits: "Number of remainder units",
    ruleApplied: "Applied allocation rule",

    inputs: "Entered",
    formula:
      "wᵢ = pᵢ·(Q/qᵢ), Q = LCM(qᵢ)     N = round(|amount|/unit)     bᵢ = floor(N·wᵢ/W)     remainder R = N − Σbᵢ, allocated by the chosen rule",

    errorTotalAmount: "The total amount must be between −10^12 and 10^12.",
    errorWeights: "The shares must be 1 to 500 weights, each non-negative, at least one greater than zero.",
    errorSmallestUnit: "The smallest unit was not recognised.",
  },

  "racun-iban-provera": {
    regime: "Mode",
    regimeDomaci: "Domestic account (3-13-2)",
    regimeIban: "IBAN",
    regimeMod97: "Check number by modulus 97",
    mode: "Action",
    modeCheck: "Check",
    modeCompute: "Calculating the check number",
    account: "Account number",
    accountHint: "18 digits to check, 16 digits (3 bank + 13 part) to calculate.",
    iban: "IBAN",
    ibanHint: "5 to 34 characters, letters and digits. Spaces are removed, lowercase becomes uppercase.",
    bban: "BBAN",
    country: "Country code",
    countryHint: "Two letters, e.g. RS. The IBAN length per country is not checked.",
    digits: "Digit string",
    yes: "Yes",
    no: "No",
    notApplicable: "not applicable in this mode",

    results: "Result",
    grouped: "Notation in groups of four",
    bank: "Bank",
    accountNumber: "Part",
    digitsFull: "Full string with the check number",
    checkDigits: "Check number",
    remainder: "Remainder modulo 97",
    matches: "The check number matches",
    matchesNote:
      "A match by modulus 97 means only that the string agrees with its own check arithmetic — not that the account exists, is open, or whose it is.",

    inputs: "Entered",
    formula:
      "r = 0; for each digit c: r = (r·10 + c) mod 97     check = 98 − mod97(string ‖ “00”)",

    errorAccount: "The account number must have exactly 18 (check) or 16 (calculate) digits.",
    errorIban: "The IBAN must have two country letters, two check digits in the range 02–98, and a BBAN.",
    errorBban: "To calculate, enter a valid BBAN and a two-letter country code.",
    errorDigits: "The string must have 1 to 60 digits (at least 3 to check).",
  },

  "radni-dani": {
    from: "From the date",
    to: "To the date",
    dateHint: "Format YYYY-MM-DD.",
    includeLastDay: "Include the last day",
    weekdays: "Non-working days of the week",
    weekdaysHint:
      "Numbers 1–7 separated by commas (1 = Monday … 7 = Sunday). No day is built in as non-working.",
    dates: "Non-working dates",
    datesHint:
      "One date per line, YYYY-MM-DD. The tool carries no date — the list is your input.",
    yes: "Yes",
    no: "No",

    results: "Result",
    calendarDays: "Calendar days",
    workingDays: "Working days",
    weekdayNonWorking: "Non-working by day of the week",
    listedNonWorking: "Non-working by the entered list",
    listedInRange: "Entered dates in range",
    fullWeeks: "Whole weeks",
    remainderDays: "Remaining days",
    reversedNote:
      "The entered dates were reversed — the bounds were swapped, and the day count is still positive.",
    effectiveLastDate: "The last day of the range after any swap",
    firstWorkingDay: "First working day",
    lastWorkingDay: "Last working day",
    datesOutOfRange: "Entered dates outside the range",

    inputs: "Entered",
    formula:
      "for each day x in the range: nonWorkingByWeekday || enteredNonWorking || working — order matters, the day is counted once",

    errorFrom: "The date from is not a valid calendar date.",
    errorTo: "The date to is not a valid calendar date.",
    errorWeekdays: "The non-working days of the week must be numbers 1 to 7, without repetition.",
    errorDates: "The list of non-working dates may have at most 400 dates, all valid.",
  },

  "rok-poslednji-dan": {
    direction: "Direction",
    directionForward: "Forwards",
    directionBackward: "Backwards",
    startDate: "Start date",
    endDate: "End date",
    dateHint: "Format YYYY-MM-DD.",
    length: "Term length",
    unit: "Unit",
    unitDays: "Days",
    unitMonths: "Months",
    unitYears: "Years",
    countStartDay: "Count the start day",
    countStartDayHint: "An explicit switch, not a hidden assumption.",
    weekdays: "Non-working days of the week",
    weekdaysHint: "Numbers 1–7 separated by commas (1 = Monday … 7 = Sunday).",
    dates: "Non-working dates",
    datesHint: "One date per line, YYYY-MM-DD. The tool carries no date.",
    shift: "Moving off a non-working day",
    shiftNone: "No move",
    shiftForward: "To the next working day",
    shiftBackward: "To the previous working day",
    yes: "Yes",
    no: "No",

    results: "Result",
    rawLastDay: "Last day before the move",
    lastDay: "Last day after the move",
    shiftedByDays: "Moved by (days)",
    totalDays: "Total calendar days to expiry (after the move)",
    totalDaysBeforeShift: "Total calendar days to expiry (before the move)",
    expiredNote: "A zero-length term with the start day included expires before it begins.",
    candidateStart: "Possible start date",
    colStart: "Possible start date",
    colRawLast: "Last day before the move",
    colLast: "Last day after the move",
    noCandidates: "No start date gives the entered end date with the entered duration.",
    weekday1: "Monday",
    weekday2: "Tuesday",
    weekday3: "Wednesday",
    weekday4: "Thursday",
    weekday5: "Friday",
    weekday6: "Saturday",
    weekday7: "Sunday",

    inputs: "Entered",
    formula:
      "days: last = start + length − (countStartDay ? 1 : 0)     months/years: min(day, daysInMonth(targetYear, targetMonth))     move: +1/−1 day while the day is non-working",

    errorDate: "The date is not a valid calendar date.",
    errorLength: "The term length is a whole number from 0 to 36500.",
    errorWeekdays: "The non-working days of the week must be numbers 1 to 7, without repetition.",
    errorDates: "The list of non-working dates may have at most 400 dates, all valid.",
  },

  "strane-teksta": {
    text: "Text",
    textHint: "Pasted text, up to 2 000 000 characters.",
    charactersPerPage: "Characters per billing page",
    charactersPerPageHint: "From the tariff you apply. Neagle offers no value.",
    countSpaces: "Count spaces",
    countSpacesHint: "There are two practices and the difference is large.",
    yes: "Yes",
    no: "No",
    rounding: "Rounding",
    roundingUp: "Up to a whole page",
    roundingHalf: "To half a page",
    roundingExact: "Exact",
    pricePerPage: "Price per page",
    priceHint: "Optional. From the tariff or contract you apply.",

    results: "Result",
    charsBefore: "Characters before NFC normalisation",
    charsWith: "Characters with spaces",
    charsWithout: "Characters without spaces",
    words: "Words",
    lines: "Lines",
    exactPages: "Pages exact",
    pagesUp: "Pages up",
    pagesHalf: "Pages to half",
    billedPages: "Pages billed (by the chosen rounding)",
    amount: "Amount",

    inputs: "Entered",
    formula:
      "basis = countSpaces ? withSpaces : withoutSpaces     pagesExact = basis / charsPerPage     pagesUp = ceil(pagesExact)     pagesHalf = ceil(pagesExact·2)/2",

    errorText: "The text may have at most 2 000 000 characters.",
    errorCharactersPerPage: "Characters per page is a whole number from 1 to 100000.",
    errorPrice: "The price per page may not be negative.",
  },

  "suvlasnicki-udeli": {
    shares: "Shares",
    sharesHint: "One fraction numerator/denominator per line, e.g. 1/3.",
    totalArea: "Total area",
    totalAreaHint: "In m². Optional — without it the area column is not shown.",
    targetDenominator: "Target denominator",
    targetDenominatorHint:
      "Optional. Without it the least common multiple of the entered denominators is used.",
    yes: "Yes",
    no: "No",

    results: "Result",
    colIndex: "#",
    colFraction: "Reduced form",
    colCommon: "Over the common denominator",
    colPercent: "Percentage",
    colArea: "Area (m²)",
    colTarget: "Over the target denominator",
    doesNotFit: "does not fit without a remainder",
    isWhole: "The sum is exactly the whole",
    commonDenominator: "Common denominator",
    sumNumerator: "Sum of numerators over the common denominator",
    difference: "Difference to the whole",

    inputs: "Entered",
    formula:
      "g = GCD(n, d); share = (n/g)/(d/g)     L = LCM of all reduced denominators     Σ == L ⟺ the sum is exactly the whole, an integer comparison",

    errorShares: "The shares are 1 to 200 fractions, numerator ≥ 0, denominator > 0.",
    errorTotalArea: "The total area must be greater than zero, at most 10^9 m².",
    errorTargetDenominator: "The target denominator is a whole number from 1 to 10^9.",
  },

  "troskovi-srazmerno-uspehu": {
    source: "Source of the success ratio",
    sourceAmounts: "Ratio of the requested and awarded amount",
    sourcePercent: "Directly entered percentage",
    claimed: "Requested amount",
    awarded: "Awarded amount",
    successPercentLabel: "Success ratio",
    firstCosts: "Costs of the first party",
    secondCosts: "Costs of the second party",

    results: "Result",
    successPercent: "Success ratio",
    complementPercent: "Complement to 100%",
    firstShare: "Proportional share of the first party's costs",
    secondShare: "Proportional share of the second party's costs",
    difference: "Difference",
    sideFirst: "to the first party",
    sideSecond: "to the second party",
    sideNone: "no difference",

    inputs: "Entered",
    formula:
      "u = awarded/requested (or a directly entered ratio)     first = costsFirst · u     second = costsSecond · (1 − u)",

    errorClaimed: "The requested amount must be greater than zero, at most 10^12.",
    errorAwarded: "The awarded amount must be between 0 and the requested amount.",
    errorSuccessPercent: "The success ratio must be between 0% and 100%.",
    errorFirstCosts: "The first party's costs may not be negative.",
    errorSecondCosts: "The second party's costs may not be negative.",
  },

  "ugovorna-kazna": {
    base: "Base",
    dailyRate: "Daily rate",
    dailyRateHint: "Percentage per day, from the contract. Neagle offers no value.",
    dataSource: "Source of the day count",
    dataSourceDays: "Number of days",
    dataSourceDates: "Pair of dates",
    delayDays: "Days late",
    agreedDate: "Contractual deadline",
    actualDate: "Actual performance",
    dateHint: "Format YYYY-MM-DD.",
    capPercent: "Cap (percentage of the base)",
    capPercentHint:
      "From the contract or regulation. Optional — without it the penalty is not capped. Neagle offers no value.",
    includeCompletionDay: "Include the performance day",
    yes: "Yes",
    no: "No",

    results: "Result",
    dailyAmount: "Amount per day late",
    amount: "Amount after the cap",
    uncappedAmount: "Penalty without the cap",
    capAmount: "Cap amount",
    capRatio: "Ratio",
    capDay: "The day of delay on which the cap is reached",
    noCapDayNote: "At a daily rate of 0% the cap is never reached — the day is not defined.",

    inputs: "Entered",
    formula:
      "penalty = base·(dailyRate/100)·daysLate     cap = base·(cap/100)     capDay = ceil(cap/dailyRate)",

    errorBase: "The base must be greater than zero, at most 10^12.",
    errorDailyRate: "The daily rate must be between 0% and 100%.",
    errorCapPercent: "The cap must be between 0% and 1000%.",
    errorAgreedDate: "The contractual deadline is not a valid calendar date.",
    errorActualDate: "The actual performance is not a valid calendar date.",
    errorDataSource: "Fill in either the number of days or the pair of dates, never both.",
  },

  "zbir-perioda": {
    periods: "Periods",
    periodsHint: "One period per line, YYYY-MM-DD to YYYY-MM-DD.",
    includeLastDay: "Include the last day",
    convention: "Decomposition convention",
    conventionHint: "The calendar convention is available only when exactly one period is entered.",
    convention30360: "30/360",
    conventionCalendar: "Calendar",
    yes: "Yes",
    no: "No",

    results: "Result",
    totalDays: "Total days",
    decomposition: "Decomposition",
    conventionApplied: "Applied convention",
    unitYears: "years",
    unitMonths: "months",
    unitDays: "days",

    rowsTitle: "Periods",
    colIndex: "#",
    colDays: "Days",
    colReversed: "Reversed (not summed)",

    overlapsTitle: "Overlaps",
    noOverlaps: "There are no overlaps between the entered periods.",
    overlapsNote:
      "The tool only shows the overlap — whether it counts twice depends on what is being summed, which the tool does not know.",
    colFirst: "First period",
    colSecond: "Second period",
    colFrom: "From",
    colTo: "To",
    colOverlapDays: "Days of overlap",

    inputs: "Entered",
    formula:
      "dₖ = serialDay(toₖ) − serialDay(fromₖ) + includeLastDay     30/360: years=floor(D/360), months=floor((D mod 360)/30), days=(D mod 360) mod 30",

    errorPeriods: "The periods are 1 to 200 pairs of dates, each valid.",
    errorConvention: "The calendar convention requires exactly one period.",
  },
} as const;
