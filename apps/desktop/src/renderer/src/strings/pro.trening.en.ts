/**
 * „Trening i sport" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.ts`, because the drawer's
 * rail needs them before any surface is opened.
 *
 * **A unit is copy, not a constant.** Written here rather than concatenated
 * in the surface, so a unit hard-coded in a component is not a string
 * `check:strings` cannot see.
 *
 * **Nothing in here judges.** None of these tools carry a normative band —
 * `packages/core/src/pro/trening.ts` returns quantities and nothing else, and
 * this table only ever names what a number IS, never whether it is good. The
 * two tools that carry a regulated figure — the symmetry target, the
 * weight-class limit — echo it back as „tvoja granica", never as a pass/fail.
 */
export const PRO_TRENING_EN = {
  "barbell-plate-loading": {
    target: "Desired total load",
    targetHint: "Total mass with the bar and all plates, in kilograms.",
    bar: "Bar mass",
    barHint:
      "The bar mass you have in front of you. Men's bars are usually 20 kg, women's 15 kg — check each time.",
    collar: "Mass of one collar",
    collarHint: "Mass of one collar — both are counted. Leave 0 if you do not use them.",
    plates: "Available plates",
    platesHint:
      "One plate per line: mass in kilograms, and optionally a space then the number of available pairs (e.g. “25 4”). Without a pair count — unlimited.",

    results: "Result",
    perSideTitle: "Plates for one side, heaviest to lightest",
    headMass: "Mass",
    headCount: "Count per side",
    noPlates: "No plate goes on the bar at this load.",
    barUsed: "Bar used in the calculation",
    perSideMass: "Mass per side, without collars",
    plateCount: "Number of plates per side",
    achieved: "Achieved total load",
    difference: "Difference from the requested",

    formula:
      "R = target − bar − 2·collar     the s that minimises |R − 2s| is chosen     total = bar + 2·collar + 2s",
    inputs: "Entered",

    errorTarget: "The desired total load must be greater than zero.",
    errorBar: "The bar mass may not be negative.",
    errorCollar: "The collar mass may not be negative.",
    errorPlates:
      "Check the plate list — every mass must be greater than zero, and the pair count a whole number of zero or more.",
    errorBelowBar: "The requested load is less than the bar with collars alone — there is no answer.",
    errorTooManyOperations:
      "This inventory is too fine for this load to be searched in reasonable time.",

    unitKg: "kg",
  },

  "body-fat-target-mass": {
    mass: "Body mass",
    massHint: "In kilograms.",
    bodyFat: "Body-fat percentage",
    bodyFatHint:
      "A measured value — callipers, bioimpedance or DEXA. The tool does not estimate body-fat percentage itself.",
    target: "Target body-fat percentage",
    targetHint: "The body-fat percentage you want to reach.",

    results: "Result",
    condition: "Condition of the calculation",
    conditionNote:
      "Lean (fat-free) mass is held constant — the target mass is the mass the body would have at the entered fat percentage, with the same lean mass.",
    targetMass: "Target body mass",
    change: "Change in mass",
    fatMass: "Fat mass",
    leanMass: "Lean mass",
    targetFatMass: "Fat mass at the target",

    formula:
      "fat = m × p/100     lean = m − fat     target = lean / (1 − pT/100)     change = target − m",
    inputs: "Entered",

    errorMass: "Body mass must be greater than zero.",
    errorBodyFat: "The body-fat percentage must be strictly between 0 and 100.",
    errorTarget: "The target body-fat percentage must be strictly between 0 and 100.",

    unitKg: "kg",
  },

  "body-indices": {
    mass: "Body mass",
    massHint: "In kilograms.",
    height: "Body height",
    heightHint: "In centimetres.",
    waist: "Waist circumference",
    waistHint: "In centimetres. Optional — an empty field omits the rows that use it.",
    hip: "Hip circumference",
    hipHint: "In centimetres. Optional, also needed for the waist/hip ratio.",

    results: "Result",
    bmi: "BMI",
    ponderal: "Rohrer index (mass / height³)",
    waistToHeight: "Waist / height ratio",
    waistToHip: "Waist / hip ratio",

    formula:
      "BMI = m / h²     Rohrer index = m / h³     waist/height = waist / height     waist/hip = waist / hip",
    inputs: "Entered",

    errorMass: "Body mass must be greater than zero.",
    errorHeight: "Body height must be greater than zero.",
    errorWaist: "The entered waist circumference must be greater than zero.",
    errorHip: "The entered hip circumference must be greater than zero.",

    unitKg: "kg",
    unitCm: "cm",
    unitBmi: "kg/m²",
    unitPonderal: "kg/m³",
  },

  "cadence-stride-length": {
    cadence: "Cadence",
    cadenceHint: "Steps per minute, both legs. Leave empty to calculate.",
    stepLength: "Stride length",
    stepLengthHint:
      "The length of ONE step in metres, not the whole cycle. Leave empty to calculate.",
    speedUnit: "Speed unit",
    speedUnitMps: "m/s",
    speedUnitKmh: "km/h",
    speedUnitPace: "pace (mm:ss / km)",
    speedValue: "Speed",
    speedValueHint:
      "A number for m/s or km/h, or a pace as mm:ss for seconds per kilometre. Leave empty to calculate.",
    fieldsHint: "Fill in exactly two of the three fields — cadence, stride length and speed. The third is calculated.",

    results: "Result",
    resolvedCadence: "Cadence",
    resolvedStep: "Stride length",
    stepNote: "Stride length is the length of ONE step, not the whole cycle (two steps).",
    speedMps: "Speed",
    speedKmh: "Speed",
    pacePerKm: "Pace",
    stepsPerKm: "Steps per kilometre",

    formula:
      "v = cadence × stride / 60     cadence = 60v/stride     stride = 60v/cadence     steps/km = 1000/stride",
    inputs: "Entered",

    errorFields: "Fill in exactly two of the three fields — cadence, stride length and speed.",
    errorCadence: "Cadence must be greater than zero.",
    errorStepLength: "Stride length must be greater than zero.",
    errorSpeed: "Speed must be greater than zero.",

    unitStepsPerMin: "steps/min",
    unitM: "m",
    unitMps: "m/s",
    unitKmh: "km/h",
    unitPerKm: "/km",
    unitStepsPerKm: "steps/km",
  },

  "erg-split-watts": {
    split: "500 m split",
    splitHint: "As m:ss.d (e.g. 1:45.3). Leave empty to calculate from power.",
    power: "Power",
    powerHint: "In watts. Leave empty to calculate from the split.",
    distance: "Distance for the projected time",
    distanceHint: "The distance the time is projected over at the held split.",
    fieldsHint: "Enter exactly one of the two fields — split or power. The other is calculated.",

    results: "Result",
    power2: "Power",
    split2: "500 m split",
    pace: "Pace",
    projected: "Projected time over the entered distance",
    projectedNote:
      "The projected time is not a race prediction, but the arithmetic of holding the split over the whole distance.",
    coefficientNote:
      "The coefficient {coefficient} is Concept2's published relation for the monitor display, not a measurement of energy use.",
    referenceNote:
      "The split is over {reference} m — the RowErg/SkiErg display. A 1000 m split from the monitor must first be converted into seconds per metre.",

    formula:
      "watts = 2.80 / pace³     pace = split / 500     projected time = distance × pace",
    inputs: "Entered",

    errorFields: "Enter exactly one of the two fields — split or power.",
    errorDistance: "Distance must be greater than zero.",
    errorSplit: "The split must be greater than zero.",
    errorPower: "Power must be greater than zero.",

    unitW: "W",
    unitSPerM: "s/m",
    unitM: "m",
  },

  "heart-rate-zones-karvonen": {
    hrMax: "Maximum heart rate",
    hrMaxHint:
      "A measured value, beats per minute. There is no age formula here — 220 minus age and the like are a population average, not your heart rate.",
    hrRest: "Resting heart rate",
    hrRestHint: "Beats per minute.",
    percents: "Percentages for the table",
    percentsHint:
      "Separate with a semicolon (e.g. “60; 70; 80”). An empty field gives the default scale 50–100% in steps of 5%.",
    measuredHr: "Measured heart rate, for the reverse direction",
    measuredHrHint: "Optional. The heart rate whose percentage of reserve and maximum you want to see.",

    results: "Result",
    reserve: "Heart-rate reserve",
    tableTitle: "Target heart rate by percentage",
    headPercent: "%",
    headKarvonen: "Karvonen",
    headPercentMax: "% of maximum",
    measuredTitle: "Reverse direction for the measured heart rate",
    measuredReserve: "Percentage of reserve",
    measuredMax: "Percentage of the maximum",

    formula:
      "reserve = HRmax − HRrest     Karvonen = HRrest + p×reserve     %HRmax = p×HRmax     reverse: %reserve = 100×(rate − HRrest)/reserve",
    inputs: "Entered",

    errorHrRest: "The resting heart rate must be a whole number greater than zero.",
    errorHrMax: "The maximum heart rate must be a whole number greater than the resting rate.",
    errorPercents: "Every percentage must be between 0 and 100.",
    errorMeasuredHr: "The measured heart rate must be greater than zero.",

    unitBpm: "bpm",
  },

  "interval-session-timing": {
    workMode: "Method of entering the work",
    workModeSeconds: "Seconds",
    workModeTempo: "Tempo (4 phases)",
    workSeconds: "Work duration",
    workSecondsHint: "In seconds.",
    eccentric: "Eccentric phase",
    pauseBottom: "Pause at the bottom",
    concentric: "Concentric phase",
    pauseTop: "Pause at the top",
    tempoHint:
      "Whole seconds per phase. The “X” notation is not accepted — write the number of seconds you mean.",
    restMode: "Method of entering the rest",
    restModeSeconds: "Seconds",
    restModeRatio: "Work:rest ratio",
    restSeconds: "Rest",
    restSecondsHint: "In seconds.",
    ratioWork: "Ratio — work",
    ratioRest: "Ratio — rest",
    ratioHint: "E.g. for 1:2 enter 1 and 2.",
    reps: "Repetitions per set",
    sets: "Number of sets",
    restBetweenSets: "Rest between sets",
    warmup: "Warm-up",
    cooldown: "Cool-down",
    secondsHint: "In seconds.",

    results: "Result",
    restResolved: "Rest between repetitions",
    setDuration: "Duration of one set",
    totalWork: "Total work time",
    totalRest: "Total rest time",
    total: "Total training duration",
    repRatio: "The given work:rest ratio",
    sessionRatio: "Ratio across the whole session",
    ratioNote:
      "The given ratio applies to one repetition. The ratio across the whole session also includes the rest between sets, so it is a different quantity.",

    formula:
      "set duration = reps×work + (reps−1)×rest     total = sets×set duration + (sets−1)×rest between sets + warm-up + cool-down",
    inputs: "Entered",

    errorReps: "Repetitions per set is a whole number greater than zero.",
    errorSets: "The number of sets is a whole number greater than zero.",
    errorRestBetweenSets: "The rest between sets may not be negative.",
    errorWarmup: "The warm-up may not be negative.",
    errorCooldown: "The cool-down may not be negative.",
    errorTempo:
      "Every tempo phase is a whole number of seconds of zero or more, and the sum must be greater than zero.",
    errorWork: "The work duration must be greater than zero.",
    errorRest: "The rest must be entered.",
    errorRestRatio: "Both terms of the work:rest ratio must be greater than zero.",

    unitS: "s",
  },

  "jump-height-flight-time": {
    flightTime: "Flight time",
    flightTimeHint: "In seconds. Leave empty to calculate from the height.",
    height: "Jump height",
    heightHint: "In centimetres. Leave empty to calculate from the flight time.",
    fieldsHint: "Enter exactly one of the two fields — flight time or height.",
    contactTime: "Ground contact time",
    contactTimeHint: "In seconds. Optional — adds the reactive strength index (RSI).",
    gravity: "Gravity",
    gravityHint: "In m/s². Default 9.80665 (standard gravity).",

    results: "Result",
    condition: "Condition of the calculation",
    conditionNote:
      "The flight must be symmetric about the highest point, with take-off and landing at the same height — otherwise the number describes something else.",
    height2: "Jump height",
    flightTime2: "Flight time",
    takeoff: "Speed at take-off",
    rsi: "Reactive strength index (height ÷ contact time)",
    gravityUsed: "Gravity used",

    formula: "h = g·t²/8     t = √(8h/g)     v = g·t/2     RSI = h/tk",
    inputs: "Entered",

    errorFields: "Enter exactly one of the two fields — flight time or height.",
    errorGravity: "Gravity must be greater than zero.",
    errorFlightTime: "The flight time must be greater than zero.",
    errorHeight: "The jump height must be greater than zero.",
    errorContactTime: "The contact time must be greater than zero.",

    unitCm: "cm",
    unitS: "s",
    unitMps: "m/s",
    unitG: "m/s²",
  },

  "limb-symmetry-index": {
    involved: "Value on the tested side",
    involvedHint: "In the same unit as the reference value.",
    reference: "Value on the reference side",
    referenceHint: "In the same unit as the tested value.",
    target: "Target ratio",
    targetHint:
      "From the criterion you apply. Neagle does not know which criterion that is and offers no value.",
    unit: "Unit",
    unitHint:
      "Free text (kg, cm, N, °…). Units are not converted — both values must be in the same one.",

    results: "Result",
    ratio: "Tested ÷ reference ratio",
    shortfall: "Difference up to 100%",
    needed: "Required value on the tested side, at the entered target",
    gap: "Difference between the required and measured value",
    unitNote:
      "Units are not converted — both inputs are treated as bare numbers in the same unit.",

    formula:
      "ratio = 100×tested/reference     difference to 100 = 100 − ratio     required = reference×target/100     difference = required − tested",
    inputs: "Entered",

    errorInvolved: "The value on the tested side may not be negative.",
    errorReference: "The value on the reference side must be greater than zero.",
    errorTarget: "The target ratio must be greater than zero.",
  },

  "one-rep-max-table": {
    load: "Set weight",
    loadHint: "In kilograms.",
    reps: "Number of repetitions",
    repsHint: "A whole number from 1 to 10.",
    formula2: "Formula for the table",
    formulaEpley: "Epley",
    formulaBrzycki: "Brzycki",
    step: "Rounding step",
    stepHint: "The smallest pair of plates you have, in kilograms.",
    known1Rm: "Known 1RM",
    known1RmHint: "Optional. When entered, the table is calculated from it and the formulas are not used.",
    customPercent: "Extra percentage",
    customPercentHint: "Optional — one percentage outside the 100 to 50% scale, per your programme.",

    results: "Result",
    epley: "Epley 1RM",
    brzycki: "Brzycki 1RM",
    singleRepNote: "For one repetition both numbers equal the entered weight.",
    knownNote: "The table is calculated from the entered 1RM — the formulas above are not used for the table.",
    tableTitle: "Load table",
    headPercent: "%",
    headExact: "Exact",
    headLoadable: "Rounded to the step",

    formula:
      "Epley: w×(1 + r/30)     Brzycki: w×36/(37 − r)     table: base × percentage, rounded to the step",
    inputs: "Entered",

    errorLoad: "The set weight must be greater than zero.",
    errorReps: "The number of repetitions is a whole number from 1 to 10.",
    errorStep: "The rounding step must be greater than zero.",
    errorKnown1Rm: "A known 1RM must be greater than zero.",
    errorCustomPercent: "The extra percentage must be greater than zero.",

    unitKg: "kg",
  },

  "running-pace-splits": {
    distance: "Distance",
    distanceUnit: "Distance unit",
    distanceUnitM: "m",
    distanceUnitKm: "km",
    distanceUnitMile: "international mile (1609.344 m)",
    time: "Time",
    timeHint: "As h:mm:ss or mm:ss, decimal seconds allowed. Leave empty to calculate.",
    pace: "Pace",
    paceHint: "As mm:ss. Leave empty to calculate.",
    paceUnit: "Pace unit",
    paceUnitPerKm: "per kilometre",
    paceUnitPerMile: "per mile",
    fieldsHint: "Fill in exactly two of the three fields — distance, time and pace. The third is calculated.",
    splitStep: "Split table step",
    splitStepUnit: "Step unit",
    splitStepUnitM: "m",
    splitStepUnitKm: "km",

    results: "Result",
    pacePerKm: "Pace per kilometre",
    pacePerMile: "Pace per mile",
    pacePer100m: "Pace per 100 m",
    speedKmh: "Speed",
    speedMps: "Speed",
    splitsTitle: "Split table",
    headIndex: "Split",
    headDistance: "Cumulative distance",
    headTime: "Cumulative time",

    formula:
      "pace/km = 1000×t/d     pace/mile = 1609.344×t/d     pace/100m = 100×t/d     v = d/t     split(k) = min(k×step, d)×t/d",
    inputs: "Entered",

    errorFields: "Fill in exactly two of the three fields — distance, time and pace.",
    errorStep: "The table step must be greater than zero.",
    errorDistance: "Distance must be greater than zero.",
    errorTime: "Time must be greater than zero.",
    errorPace: "Pace must be greater than zero.",
    errorTooManyRows: "The step is too fine for this distance — the table would have too many rows.",

    unitM: "m",
    unitKmh: "km/h",
    unitMps: "m/s",
    unitPerKm: "/km",
    unitPerMile: "/mile",
    unitPer100m: "/100 m",
  },

  "set-tempo-tut": {
    eccentric: "Eccentric phase",
    pauseBottom: "Pause at the bottom",
    concentric: "Concentric phase",
    pauseTop: "Pause at the top",
    tempoHint:
      "Whole seconds per phase. The “X” notation is not accepted — write the number of seconds you mean.",
    reps: "Repetitions per set",
    sets: "Number of sets",
    restBetweenSets: "Rest between sets",
    restBetweenSetsHint: "In seconds.",

    results: "Result",
    perRep: "Duration of one repetition",
    tutPerSet: "Time under load per set",
    totalTut: "Total time under load",
    block: "Total duration of the block",
    definitionNote:
      "Time under load is the sum of all four phases — both concentric phases and both pauses, not just the movement.",

    formula:
      "repetition = eccentric + pause at the bottom + concentric + pause at the top     set = reps×repetition     block = sets×set + (sets−1)×rest",
    inputs: "Entered",

    errorTempo: "Every phase is a whole number of seconds of zero or more, and the sum must be greater than zero.",
    errorReps: "Repetitions per set is a whole number greater than zero.",
    errorSets: "The number of sets is a whole number greater than zero.",
    errorRestBetweenSets: "The rest between sets is a whole number of seconds of zero or more.",

    unitS: "s",
  },

  "split-times-fatigue": {
    times: "List of times",
    timesHint: "One time per line, as mm:ss.cc or seconds with decimals. At least two lines.",

    results: "Result",
    count: "Number of times",
    total: "Sum",
    mean: "Mean",
    median: "Median",
    best: "Best",
    worst: "Worst",
    range: "Range",
    fatigueIndex: "Fatigue index (drop relative to the best time)",
    decrement: "Percentage drop (Sdec)",

    formula:
      "fatigue index = 100×(slowest − fastest)/fastest     Sdec = 100×(sum/(n×fastest) − 1)     median = middle value of the sorted list",
    inputs: "Entered",

    errorTimes: "Enter at least two times, each greater than zero.",

    unitS: "s",
    unitPercent: "%",
  },

  "sweat-rate-hydration": {
    preMass: "Mass before training",
    postMass: "Mass after training",
    massHint: "In kilograms.",
    drunk: "Fluid drunk",
    drunkHint: "In millilitres.",
    food: "Food eaten",
    foodHint:
      "Food and gels swallowed during training, in grams — they enter the balance the same as fluid.",
    urine: "Urine and other measured loss",
    urineHint: "In millilitres.",
    duration: "Training duration",
    durationHint: "In minutes.",
    replacementPercent: "Planned replacement percentage",

    results: "Result",
    conventionNote: "Convention: 1 g of mass change = 1 mL.",
    massLost: "Change in mass",
    percentBodyMass: "Body mass lost",
    sweatGrams: "Total sweat loss",
    sweatMl: "Same, by the convention 1 g = 1 mL",
    ratePerHour: "Sweat rate",
    litresPerHour: "Sweat rate",
    replacementPerHour: "Rate at the entered replacement percentage",

    formula:
      "sweat = (mass before − mass after)×1000 + fluid + food − urine     rate = 60×sweat/duration     mass percentage = 100×(mass before − mass after)/mass before",
    inputs: "Entered",

    errorPreMass: "The mass before training must be greater than zero.",
    errorPostMass: "The mass after training must be greater than zero.",
    errorDrunk: "The fluid drunk may not be negative.",
    errorFood: "The food eaten may not be negative.",
    errorUrine: "Urine may not be negative.",
    errorDuration: "The training duration must be greater than zero.",
    errorReplacementPercent: "The replacement percentage must be greater than zero.",

    unitKg: "kg",
    unitG: "g",
    unitMl: "mL",
    unitMlPerH: "mL/h",
    unitLPerH: "L/h",
    unitPercent: "%",
  },

  "training-volume-load": {
    rows: "Programme rows",
    rowsHint:
      "One row per line, as sets×reps×load, optionally ×1RM for that row (e.g. “5x5x100” or “5x5x100x130”).",

    results: "Result",
    rowsTitle: "Per row",
    headReps: "Repetitions",
    headTonnage: "Tonnage",
    headIntensity: "Intensity",
    totalSets: "Total sets",
    totalReps: "Total repetitions",
    tonnage: "Total tonnage",
    meanLoad: "Average load per repetition",
    groupsTitle: "Average intensity from the entered 1RM",
    headOneRm: "1RM",
    headMeanIntensity: "Average intensity (tonnage-weighted)",

    formula:
      "row reps = sets×reps per set     row tonnage = reps×load     average load = total tonnage/total reps     intensity = 100×average load/1RM",
    inputs: "Entered",

    errorRows:
      "Every row must have whole sets and reps greater than zero, and a load of zero or more.",

    unitKg: "kg",
    unitPercent: "%",
  },

  "weight-class-cut": {
    mass: "Current body mass",
    massHint: "In kilograms.",
    limit: "Category limit",
    limitHint:
      "From the competition rules you apply. Neagle does not know which rules those are and offers no value.",
    days: "Number of days to weigh-in",
    daysHint: "A whole number of days. The weigh-in day is not counted in the division.",

    results: "Result",
    difference: "Difference from the limit",
    aboveNote: "The current mass is above the entered limit.",
    belowNote: "The current mass is below the entered limit (a margin).",
    percentOfMass: "Same, as a percentage of the current mass",
    perDay: "Difference per day, evenly to weigh-in",
    perWeek: "Difference per week, evenly to weigh-in",
    daysUsed: "Number of days used in the division",
    extrapolatedNote:
      "The weekly value is a conversion over the entered horizon — fewer than seven days remain to weigh-in.",

    formula:
      "difference = mass − limit     percentage = 100×difference/mass     daily = difference/days     weekly = 7×difference/days",
    inputs: "Entered",

    errorMass: "The current body mass must be greater than zero.",
    errorLimit: "The category limit must be greater than zero.",
    errorDays: "The number of days to weigh-in is a whole number of zero or more.",

    unitKg: "kg",
  },
} as const;
