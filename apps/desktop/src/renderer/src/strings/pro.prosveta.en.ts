/**
 * „Prosveta i nastava" — the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.en.ts`.
 *
 * **A unit is copy, not a constant** — written here rather than concatenated
 * in the surface. **A regulated figure's hint always says the same thing**:
 * Nexus does not know the rulebook and does not guess a value for it.
 */
export const PRO_PROSVETA_EN = {
  "average-to-target": {
    mode: "Input method",
    modeGrades: "List of grades",
    modeTally: "Count and sum of grades",
    grades: "Existing grades",
    gradesHint: "One or more grades, separated by a space, a semicolon or a new line.",
    tallyCount: "Number of grades n",
    tallySum: "Sum of grades S",
    target: "Target average",
    targetHint: "The average to be reached, on the same scale as the grades.",
    extraGrade: "Value of the extra grade",
    extraGradeHint:
      "The grading scale is set by the institution (1–5, 5–10, percentages); there is no default value.",

    results: "Result",
    currentAverage: "Current average",
    outcome: "Outcome",
    extraGrades: "Number of extra grades",
    resultingAverage: "Average after them",
    outcomeNeeded: "That many grades of that value reach the target",
    outcomeAnyCount: "The target is already reached; grades of that value do not move it",
    outcomeUnreachable: "Unreachable with grades of that value",
    outcomeAlreadyBelow: "The average is already below the target, and grades of that value only push it further away",
    outcomeTolerated: "The greatest number of such grades after which the average is not yet below the target",

    inputs: "Entered",
    formula: "D = T·n − S     E = v − T     j·(v − T) ≥ T·n − S",

    errorGrades: "Enter at least one grade.",
    errorTooManyValues: "Too many grades in one input.",
    errorCount: "The number of grades must be a whole number, at least 1.",
    errorSum: "The sum of grades is not a readable number.",
    errorTarget: "The target average is not a readable number.",
    errorExtraGrade: "The value of the extra grade is not a readable number.",
  },

  "child-age": {
    birth: "Date of birth",
    on: "Date to calculate for",
    dateHint: "Format DD.MM.YYYY, e.g. 13.08.2020.",
    onHint: "Format DD.MM.YYYY. An empty field calculates for today.",
    milestoneYears: "Number of years for the birthday",
    milestoneYearsHint: "Optional — a whole number of years for which the birthday date is wanted.",

    results: "Result",
    age: "Age",
    years: "years",
    months: "months",
    days: "days",
    totalMonths: "Total completed months",
    totalDays: "Total days",
    daysUntilNextBirthday: "Days to the next birthday",
    milestoneDate: "Date of reaching the age",
    milestoneShifted: "29 February does not exist that year — 1 March used",
    borrowNote: "Borrowed from the month",
    borrowedMonth: "month",
    borrowClamped: "birth day shortened to the length of that month",
    daysUnit: "days",

    inputs: "Entered",
    formula: "d, m, y = difference in days/months/years, borrowing from the previous month when d < 0",

    errorBirth: "The date of birth is not a valid Gregorian calendar date.",
    errorOn: "The reference date is not valid or is earlier than the date of birth.",
    errorMilestoneYears: "The number of years for the birthday must be a whole number, 0 or more.",
  },

  combinatorics: {
    n: "n",
    nHint: "A whole number ≥ 0. The practical ceiling is 100,000 because of the output length.",
    k: "k",
    kHint: "A whole number ≥ 0.",
    repeats: "Repeat counts (for permutations with repetition)",
    repeatsHint:
      "Optional — whole numbers ≥ 1 whose sum is ≤ n, separated by a space or comma. In this mode k is ignored.",

    results: "Result",
    factorial: "n!",
    variations: "Variations without repetition V(n,k)",
    combinations: "Combinations without repetition C(n,k)",
    variationsWithRepetition: "Variations with repetition n^k",
    combinationsWithRepetition: "Combinations with repetition C(n+k−1,k)",
    permutationsWithRepetition: "Permutations with repetition",
    factorialDigits: "Number of digits in n!",

    inputs: "Entered",
    formula: "n! = Π i     V(n,k) = n!/(n−k)!     C(n,k) = n!/(k!(n−k)!)     n^k     C(n+k−1,k)",

    errorN: "n must be a whole number from 0 to 100,000.",
    errorK: "k must be a whole number from 0 to 100,000.",
    errorRepeats: "The repeat counts must be whole numbers ≥ 1 whose sum is ≤ n.",
  },

  "fractions-decimals": {
    mode: "Kind of work",
    modeCompute: "Arithmetic",
    modeConvert: "Convert a decimal",
    a: "Numerator a",
    b: "Denominator b",
    operation: "Operation",
    c: "Numerator c",
    d: "Denominator d",
    decimalInput: "Decimal notation",
    decimalInputHint:
      "Whole part, comma, non-repeating digits, period in brackets — e.g. 0.1(6) or 3.75.",

    results: "Result",
    reducedFraction: "Reduced fraction",
    mixedNumber: "Mixed number",
    decimalResult: "Decimal notation",
    decimalLengths: "Length of the non-repeating / repeating part",
    decimalTooLong: "Too long to display (over 2000 digits).",
    percent: "Percentage",
    percentApprox: "The percentage is rounded to six decimals, it is not the exact value.",

    inputs: "Entered",
    formulaCompute: "a/b + c/d = (ad + cb)/(bd)     a/b × c/d = ac/(bd)     a/b ÷ c/d = ad/(bc)",
    formulaConvert: "value = (I·10^(n+r) + N·10^r + R − (I·10^n + N)) / (10^(n+r) − 10^n)",

    errorA: "Numerator a must be a whole number.",
    errorB: "Denominator b must be a whole number other than zero.",
    errorC: "Numerator c must be a whole number (and non-zero for division).",
    errorD: "Denominator d must be a whole number other than zero.",
    errorOperation: "The operation was not recognised.",
    errorDecimalNotation: "The notation is not readable — use the form 0.1(6) or 3.75.",
  },

  "grade-scale-points": {
    maxPoints: "Maximum score B",
    step: "Scoring step k",
    stepHint: "Typically 1 or 0.5. An empty field calculates with a step of 1.",
    thresholds: "Thresholds (label; threshold in %)",
    thresholdsHint:
      "One row per threshold — label and percentage separated by a semicolon, e.g. “5; 91”. The thresholds are set by the institution's or ministry's rulebook; Nexus has no built-in scale.",
    scoredPoints: "Score achieved",
    scoredPointsHint: "Optional — the score for which the label from the scale is wanted.",

    results: "Result",
    colLabel: "Label",
    colThreshold: "Threshold %",
    colMinPoints: "Minimum score",
    colMinPercent: "Actual %",
    colRange: "Score range",
    unreachableRow: "unreachable at the given B and k",
    unlabelled: "No label",
    scoredPercent: "Percentage of the score achieved",
    scoredLabel: "Label from the scale",
    noLabel: "no label (below the lowest threshold)",
    unitPoints: "pts",

    inputs: "Entered",
    formula:
      "m = ceilDiv(threshold·B, 100·k)     minScore = m·k     minimum percentage = 100·minScore/B",

    errorMaxPoints: "The maximum score must be greater than zero.",
    errorStep: "The scoring step must be greater than zero and not greater than the maximum.",
    errorThresholds:
      "The thresholds must be numbers in [0, 100], each written as “label; percentage”.",
    errorTooManyRows: "Too many threshold rows in one input.",
    errorDuplicateThreshold: "Two thresholds have the same value — the range between them does not exist.",
    errorScoredPoints: "The score achieved must be in [0, B].",
  },

  "grade-statistics": {
    values: "Values",
    valuesHint:
      "Grades or scores, separated by a space, a semicolon or a new line. A comma is the decimal mark — “3,5” is one value.",
    passThreshold: "Pass threshold",
    passThresholdHint:
      "Optional. The limit is set by the institution or ministry; Nexus does not assume it.",

    results: "Result",
    count: "n",
    sum: "Sum",
    mean: "Arithmetic mean",
    min: "Minimum",
    max: "Maximum",
    range: "Range",
    median: "Median",
    q1: "Q1",
    q3: "Q3",
    iqr: "IQR",
    quartilesAbsentNote: "The quartiles are not calculated — a single value has neither a lower nor an upper half.",
    quartilesDegenerateNote:
      "n < 4: the exclusive method here leaves one value on each side, so these numbers should not be read as a true measure of spread.",
    quartileMethodNote: "Quartiles: exclusive method (Moore–McCabe).",
    populationVariance: "Population variance",
    populationDeviation: "Population standard deviation",
    sampleVariance: "Sample variance",
    sampleDeviation: "Sample standard deviation",
    modes: "Mode",
    noMode: "no mode",
    colValue: "Value",
    colCount: "Count",
    colShare: "Share",
    shareRoundingNote: "The shares are rounded independently, so their sum need not be exactly 100.00%.",
    atOrAbove: "Number of values ≥ threshold",

    inputs: "Entered",
    formula: "mean = Σx/n     σ² = Σ(x−mean)²/n     s² = Σ(x−mean)²/(n−1)",

    errorValues: "Enter at least one value.",
    errorTooManyValues: "Too many values in one input.",
    errorPassThreshold: "The pass threshold is not a readable number.",
    errorToken: "Value number {index} is not a readable number.",
  },

  "guessing-correction": {
    questions: "Total number of questions Q",
    right: "Number of correct answers R",
    wrong: "Number of incorrect answers W",
    unanswered: "Number of unanswered U",
    options: "Number of options per question k",
    optionsHint: "A whole number ≥ 2.",
    points: "Points per question",
    pointsHint: "An empty field calculates with 1 point per question.",

    results: "Result",
    corrected: "Corrected score (in questions)",
    percentOfMax: "Percentage of the maximum",
    expectedBefore: "Expected correct before correction (Q/k)",
    expectedAfter: "Expected after correction (a pure guesser)",
    answeredMismatch: "Difference R+W+U − Q",

    inputs: "Entered",
    formula: "S = R − W/(k−1)     points = S · points per question     percentage = 100·S/Q",

    errorQuestions: "The total number of questions must be a whole number greater than zero.",
    errorRight: "The number of correct answers must be a whole number ≥ 0.",
    errorWrong: "The number of incorrect answers must be a whole number ≥ 0.",
    errorUnanswered: "The number of unanswered must be a whole number ≥ 0.",
    errorOptions: "The number of options must be a whole number ≥ 2.",
    errorPoints: "The points per question must be greater than zero.",
  },

  "item-analysis": {
    correct: "Number of correct answers C",
    students: "Number of pupils N",
    studentsHint: "Pupils who attempted the item — this number goes into p = C/N.",
    unanswered: "Unanswered (outside N)",
    unansweredHint: "Optional — pupils who did not attempt the item at all.",
    treatment: "How the unanswered are counted",
    treatmentAsIncorrect: "As incorrect (increasing N)",
    treatmentExcluded: "Excluded (N stays the same)",
    upperCorrect: "Correct in the upper group C_g",
    upperSize: "Size of the upper group N_g",
    lowerCorrect: "Correct in the lower group C_s",
    lowerSize: "Size of the lower group N_s",

    results: "Result",
    facility: "Facility index p (higher = easier)",
    n: "N used in p",
    upperRate: "Success of the upper group",
    lowerRate: "Success of the lower group",
    discrimination: "Discrimination index D",
    groupCoverage: "Share of the class the groups cover",

    inputs: "Entered",
    formula: "p = C/N     D = C_g/N_g − C_s/N_s",

    errorStudents: "The number of pupils must be a whole number greater than zero.",
    errorCorrect: "The number of correct answers must be a whole number from 0 to N.",
    errorUnansweredTreatment: "Choose how the unanswered are counted.",
    errorUnanswered: "The number of unanswered must be a whole number ≥ 0.",
    errorUpper:
      "Upper group: the correct count and the size must be whole numbers, correct ≤ size and ≤ N, C.",
    errorLower:
      "Lower group: the correct count and the size must be whole numbers, correct ≤ size and ≤ N, C.",
    errorGroups: "The sum of the groups may not exceed the total number of pupils or of correct answers.",
  },

  "lesson-count-period": {
    start: "Start date",
    end: "End date",
    dateHint: "Format DD.MM.YYYY.",
    weekdays: "Days of the week with a lesson count",
    weekdaysHint:
      "One row per day: the day of the week (1 = Monday … 7 = Sunday, ISO 8601) and the number of lessons, separated by a semicolon — e.g. “2; 1”.",
    excludedDates: "Excluded dates",
    excludedDatesHint:
      "One date per line, format DD.MM.YYYY. Nexus has no built-in holiday calendar — only the dates entered here are counted.",
    makeupDays: "Days that follow another day's schedule",
    makeupDaysHint:
      "One row per day: the date and the day of the week whose schedule applies, separated by a semicolon — e.g. “15.10.2026; 1”.",
    lessonMinutes: "Lesson duration (minutes)",
    prescribedHours: "Prescribed lesson fund",
    prescribedHoursHint: "Optional — the annual fund from the curriculum; Nexus does not know it.",

    results: "Result",
    colWeekday: "Day",
    colLessons: "Lessons/day",
    colOccurrences: "Occurrences",
    colExcluded: "Excluded",
    colMakeupAway: "Made up from",
    colMakeupInto: "Made up to",
    colSessions: "Sessions",
    colDate: "Date",
    colWeekdayName: "Day of the week",
    colReason: "Reason",
    totalSessions: "Total sessions",
    totalLessons: "Total lessons",
    totalExcluded: "Total deducted sessions",
    totalTime: "Total duration",
    ignoredOffWeekday: "Ignored — a day with no lessons",
    ignoredOffPeriod: "Ignored — outside the period or a duplicate",
    reasonOffPeriod: "outside the period",
    reasonDuplicate: "duplicate",
    reasonOffWeekday: "day with no lessons",
    prescribedHoursLabel: "Prescribed lesson fund",
    hoursDifferenceLabel: "Difference calculated − prescribed",
    hoursRatioLabel: "Ratio calculated/prescribed",
    noHolidayNote:
      "Nexus has no built-in holiday calendar — only the dates you enter are deducted.",
    weekdayNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],

    inputs: "Entered",
    formula:
      "first = start + ((w − isoDay(start)+7) mod 7)     sessions = max(0, count − excluded − madeUpFrom + madeUpTo)",

    errorStart: "The start date is not a valid Gregorian calendar date.",
    errorEnd: "The end date is not valid or is earlier than the start.",
    errorLessonMinutes: "The lesson duration must be a whole number from 1 to 600 minutes.",
    errorWeekdays: "The days of the week must be whole numbers 1–7, without repetition, at least one row.",
    errorLessons: "The number of lessons per day must be a whole number from 1 to 10.",
    errorPrescribedHours: "The prescribed lesson fund must be greater than zero.",
    errorTooManyRows: "Too many rows in one input.",
    errorExcludedDates: "Every excluded date must be a valid Gregorian calendar date.",
    errorMakeupDays:
      "Every make-up row must have a valid date within the period and a day of the week 1–7, without clashing with excluded or other make-up days.",
  },

  "lesson-timeline": {
    start: "Start time",
    startHint: "Format HH:MM, 24-hour, e.g. 08:00.",
    activities: "Activities (name; duration in minutes)",
    activitiesHint:
      "One row per activity, name and duration separated by a semicolon — e.g. “Introduction; 5”.",
    lessonMinutes: "Lesson duration (minutes)",
    lessonMinutesHint: "Optional — the frame the activities fit into.",
    dayUnit: "day",

    results: "Result",
    colName: "Activity",
    colStart: "Start",
    colEnd: "End",
    colDuration: "Duration",
    colShare: "Share",
    shareRoundingNote: "The shares are rounded independently, so their sum need not be exactly 100.00%.",
    totalMinutes: "Total duration (minutes)",
    end: "End of the last activity",
    slack: "Remaining (+) or overrun (−) time",

    inputs: "Entered",
    formula: "end_i = t0 + Σ_{j≤i} d_j     share_i = 100·d_i/Σd     remainder = lesson duration − Σd",

    errorStart: "The start time must be in the form HH:MM, 00:00–23:59.",
    errorDurations: "Enter at least one activity with a duration ≥ 0 minutes and a sum greater than zero.",
    errorTooManyRows: "Too many rows in one input.",
    errorLessonMinutes: "The lesson duration must be a whole number from 1 to 600 minutes.",
  },

  "split-into-groups": {
    students: "Number of pupils N",
    mode: "Method of division",
    modeByGroups: "Into k groups",
    modeBySize: "Groups of g pupils",
    valueByGroups: "Number of groups k",
    valueBySize: "Group size g",
    minGroupSize: "Smallest allowed group",
    minGroupSizeHint: "Optional — a division in which any group would be smaller than this number is refused.",

    results: "Result",
    groups: "Number of groups",
    colCount: "Number of groups",
    colSize: "Size",
    checkSum: "Check of the sum (∑ size · count)",
    emptyGroups: "Empty groups",
    groupsWithMembers: "Groups with members",
    fullGroups: "Full groups (without equalising)",
    remainder: "Remaining pupils",
    fullCheckSum: "Check of the sum (full groups + remainder)",
    largestGroupWithinSize: "Largest group ≤ requested size",
    yes: "Yes",
    no: "No",

    inputs: "Entered",
    formula: "q = floor(N/k)     r = N mod k     r groups of (q+1), (k−r) groups of q",

    errorStudents: "The number of pupils must be a whole number greater than zero.",
    errorGroups: "The number of groups must be a whole number greater than zero.",
    errorSize: "The group size must be a whole number greater than zero.",
    errorMinGroupSize: "The smallest group this division would give is below the entered minimum.",
  },

  "standard-score": {
    raw: "Raw score x",
    mean: "Arithmetic mean μ",
    deviation: "Standard deviation σ",
    deviationKind: "Kind of deviation",
    deviationPopulation: "Population (divided by n)",
    deviationSample: "Sample (divided by n−1)",
    targetMean: "Target mean M",
    targetHint:
      "Optional — an arbitrary scale, e.g. mean 100, deviation 15. Both fields are entered together.",
    targetDeviation: "Target deviation S",
    zForRaw: "z-value for the reverse calculation",
    reverseHint: "Optional — returns the raw score from a z, T-score or value on the target scale.",
    tScoreForRaw: "T-score for the reverse calculation",
    targetScoreForRaw: "Value on the target scale for the reverse calculation",

    results: "Result",
    z: "z",
    tScore: "T-score",
    tScoreSource:
      "T-scale (mean 50, standard deviation 10) after: W. A. McCall, How to Measure in Education, 1922.",
    targetScore: "Value on the target scale",
    rawFromZ: "Raw score from z",
    rawFromTScore: "Raw score from the T-score",
    rawFromTargetScore: "Raw score from the target scale",

    inputs: "Entered",
    formula: "z = (x − μ)/σ     T = 50 + 10·z     y = M + S·z     x = μ + z·σ",

    errorRaw: "The raw score is not a readable number.",
    errorMean: "The arithmetic mean is not a readable number.",
    errorDeviation: "The standard deviation must be greater than zero.",
    errorDeviationKind: "Choose the kind of deviation.",
    errorTargetMean: "The target mean is not a readable number — enter the target deviation too.",
    errorTargetDeviation: "The target deviation must be greater than zero — enter the target mean too.",
    errorZForRaw: "The z-value for the reverse calculation is not a readable number.",
    errorTScoreForRaw: "The T-score for the reverse calculation is not a readable number.",
    errorTargetScoreForRaw:
      "For a reverse calculation from the target scale, first enter the target mean and deviation.",
  },

  "test-printing": {
    pages: "Number of pages per copy",
    copies: "Number of copies",
    duplex: "Duplex printing",
    duplexYes: "Yes",
    duplexNo: "No",
    sheetsPerPack: "Sheets per pack",
    sheetsPerPackHint: "Read from the paper pack.",
    price: "Price per sheet",
    priceHint: "Optional — the market price; Nexus does not know or remember it.",

    results: "Result",
    sheetsPerCopy: "Sheets per copy",
    totalPages: "Total pages",
    totalSheets: "Total sheets",
    blankBacks: "Blank backs",
    packs: "Number of packs",
    leftInLastPack: "Left over in the last pack",
    amount: "Amount",
    impositionNote:
      "Assumption: one test page per printed side of a sheet (no booklet/imposition). The amount is the simple product of the sheet count and the entered price, without tax and without currency conversion.",

    inputs: "Entered",
    formula:
      "sheets/copy = duplex ? ceil(pages/2) : pages     packs = ceil(sheets/pack)",

    errorPages: "The number of pages per copy must be a whole number greater than zero.",
    errorCopies: "The number of copies must be a whole number greater than zero.",
    errorSheetsPerPack: "The sheets per pack must be a whole number greater than zero.",
    errorPrice: "The price per sheet must be a number greater than or equal to zero.",
  },

  "topic-hour-allocation": {
    totalHours: "Total number of lessons T",
    topics: "Topics (name; weight)",
    topicsHint:
      "One row per topic, name and weight separated by a semicolon — e.g. “Introduction; 20”. The weights need not add up to 100.",

    results: "Result",
    colName: "Topic",
    colQuota: "Exact quota",
    colHours: "Lessons",
    colShare: "Actual share",
    colExtraHour: "Extra lesson",
    extraHourMark: "extra lesson",
    checkSum: "Check of the sum (= T)",
    extraHourCount: "Number of topics with an extra lesson",
    methodNote: "Allocation: the largest-remainder rule (Hamilton method).",
    yes: "Yes",
    no: "No",

    inputs: "Entered",
    formula:
      "quota_i = T·w_i/Σw     a_i = floor(quota_i)     the remaining T−Σa_i lessons go to the largest remainders",

    errorTotalHours: "The total number of lessons must be a whole number greater than zero.",
    errorWeights: "Enter at least one row with a weight > 0; all weights must be ≥ 0.",
    errorTooManyRows: "Too many rows in one input.",
  },

  "weighted-grade": {
    components: "Components (name; achieved; maximum; weight)",
    componentsHint:
      "One row per component, separated by semicolons — e.g. “Midterm 1; 18; 25; 20”. At least one row must have a weight > 0.",
    totalPoints: "Total number of points T",
    totalPointsHint: "Optional — the scale the result is mapped onto.",
    targetPercent: "Target overall percentage",
    pendingName: "Name of the remaining component",
    pendingMax: "Maximum of the remaining component",
    pendingWeight: "Weight of the remaining component",

    results: "Result",
    colName: "Component",
    colPercent: "Percentage",
    colWeight: "Normalised weight",
    weight: "weight",
    totalPercent: "Weighted percentage",
    lowerBoundNote:
      "The remaining component has no grade yet — this is a lower bound, not a final result.",
    mappedPoints: "Mapped onto T points",
    targetOutcome: "Outcome",
    outcomeReachable: "Points needed on the remaining component",
    outcomeAlreadyMet: "The target is already reached — 0 points needed",
    outcomeUnreachable: "Unreachable on the remaining component",
    requiredPoints: "Number of points needed",

    inputs: "Entered",
    formula: "total = 100·(Σ w_i·r_i)/Σw     a_t = ((P/100)·Σw − Σ_{i≠t} w_i·r_i)·m_t/w_t",

    errorComponents: "Enter at least one component.",
    errorTooManyRows: "Too many rows in one input.",
    errorComponentMax: "The maximum of every component must be greater than zero.",
    errorComponentScored: "The points achieved must be in [0, maximum].",
    errorComponentWeight: "A component's weight must be ≥ 0.",
    errorPendingMax: "The maximum of the remaining component must be greater than zero.",
    errorPendingWeight: "The weight of the remaining component must be greater than zero.",
    errorWeights: "The sum of all weights (including the remaining component) must be greater than zero.",
    errorTotalPoints: "The total number of points must be greater than zero.",
    errorTargetPercent: "The target percentage must be in [0, 100].",
  },
} as const;
