/**
 * „Auto" — the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in a different table another process owns.
 *
 * **Two tools print a number beside a limit the user typed and say nothing about
 * the pair.** Mean piston speed and compression ratio are quantities; whether a
 * build's limit or a fuel's tolerance applies is the person at the engine's call.
 *
 * **A unit is copy, not a constant.** „mm", „cm³", „cc/min" and „lb/h" are
 * written here rather than concatenated in the surface.
 */
export const PRO_AUTO_EN = {
  "engine-displacement": {
    bore: "Cylinder bore",
    stroke: "Piston stroke",
    cylinders: "Number of cylinders",
    results: "Result",
    perCylinder: "Swept volume of one cylinder",
    total: "Total engine displacement",
    totalLitres: "Displacement in litres",
    boreStrokeRatio: "Bore-to-stroke ratio",
    formulaLine: "V_h = π/4·b²·s     V = V_h·n",
    inputs: "Entered",
    unitMm: "mm",
    unitCc: "cm³",
    unitL: "l",
    errorBore: "The bore is between 10 and 400 mm.",
    errorStroke: "The stroke is between 10 and 400 mm.",
    errorCylinders: "The number of cylinders is a whole number from 1 to 16.",
  },

  "compression-ratio": {
    bore: "Cylinder bore",
    stroke: "Piston stroke",
    chamberVolume: "Combustion chamber volume",
    gasketVolume: "Head gasket volume",
    gasketHint: "At its compressed thickness. An empty field means zero.",
    deckVolume: "Piston deck clearance volume",
    deckHint: "The space between the crown and the head at top dead centre. An empty field means zero.",
    pistonVolume: "Piston crown volume",
    pistonHint: "Positive for a dish, negative for a dome. An empty field means zero.",
    results: "Result",
    compressionRatio: "Compression ratio",
    sweptVolume: "Swept volume of the cylinder",
    clearanceVolume: "Clearance volume",
    formulaLine: "CR = (V_h + V_c)/V_c     V_c = chamber + gasket + deck + crown",
    inputs: "Entered",
    unitCc: "cm³",
    errorBore: "The bore is between 10 and 400 mm.",
    errorStroke: "The stroke is between 10 and 400 mm.",
    errorChamber: "The chamber volume is between 0.5 and 1000 cm³.",
    errorGasket: "The gasket volume is between −500 and 500 cm³.",
    errorDeck: "The deck clearance volume is between −500 and 500 cm³.",
    errorPiston: "The crown volume is between −500 and 500 cm³.",
    errorClearance: "The total clearance volume must be greater than zero.",
  },

  "mean-piston-speed": {
    stroke: "Piston stroke",
    rpm: "Engine speed",
    limit: "Limit for this build",
    limitHint:
      "From the engine's data or from the build. Nexus does not know it and offers no figure; an " +
      "empty field leaves it out.",
    results: "Result",
    speed: "Mean piston speed",
    speedRatio: "Ratio to the limit",
    speedPer1000Rpm: "Speed at 1000 rpm",
    speedFpm: "Mean speed in feet per minute",
    formulaLine: "v̄ = 2·s·n/60",
    inputs: "Entered",
    unitMm: "mm",
    unitMs: "m/s",
    unitRpm: "rpm",
    unitFpm: "ft/min",
    errorStroke: "The stroke is between 10 and 400 mm.",
    errorRpm: "The engine speed is between 100 and 30 000 rpm.",
    errorLimit: "The limit is between 1 and 60 m/s.",
  },

  "injector-flow": {
    targetPower: "Target engine power",
    bsfc: "Brake-specific fuel consumption",
    bsfcHint:
      "In grams per kilowatt-hour, from the engine's data. Petrol and diesel have different figures.",
    cylinders: "Number of cylinders",
    duty: "Maximum injector duty cycle",
    dutyHint: "In percent of the cycle time. 80 % is the usual figure and it is yours.",
    fuelDensity: "Fuel density",
    fuelDensityHint: "In kilograms per litre, at the working temperature. Not entered for you.",
    results: "Result",
    fuelMassFlow: "Fuel mass flow",
    fuelVolumeFlow: "Fuel volume flow",
    injectorFlow: "Flow needed from one injector",
    injectorFlowCcPerMin: "Injector flow in cc/min",
    injectorFlowLbPerH: "Injector flow in lb/h",
    dutyUsed: "Duty cycle counted",
    sizingNote:
      "This sizes the injector. Whether the pump, the lines and the tune can carry it is not in " +
      "this calculation.",
    formulaLine: "ṁ = P·BSFC     per injector = ṁ/n ÷ (duty/100)     1 lb = 0.45359237 kg",
    inputs: "Entered",
    unitKgPerH: "kg/h",
    unitLPerH: "l/h",
    unitCcPerMin: "cc/min",
    unitLbPerH: "lb/h",
    unitGKwh: "g/kWh",
    unitKgPerL: "kg/l",
    errorPower: "The target power is between 0.1 and 5000 kW.",
    errorBsfc: "The specific consumption is between 50 and 1000 g/kWh.",
    errorCylinders: "The number of cylinders is a whole number from 1 to 16.",
    errorDuty: "The duty cycle is between 10 and 100 percent.",
    errorDensity: "The fuel density is between 0.5 and 1.5 kg/l.",
  },

  "air-fuel-ratio": {
    mode: "Mode",
    modeFromMasses: "Ratio from measured masses",
    modeForTarget: "Fuel for a target ratio",
    airMass: "Air mass",
    fuelMass: "Fuel mass",
    targetAfr: "Target air-fuel ratio",
    stoichiometricAfr: "Stoichiometric ratio of the fuel",
    stoichiometricHint:
      "The ratio for the fuel you run — petrol about 14.7, E85 about 9.8, diesel about 14.5. " +
      "Lambda is worked out only when this figure is entered.",
    results: "Result",
    airFuelRatio: "Air-fuel ratio",
    lambda: "Lambda",
    formulaLine: "AFR = m_air/m_fuel     λ = AFR/AFR_stoich",
    inputs: "Entered",
    notGiven: "not entered",
    unitG: "g",
    errorAir: "The air mass must be greater than zero.",
    errorFuel: "The fuel mass must be greater than zero.",
    errorTarget: "The target ratio is between 1 and 40.",
    errorStoich: "The stoichiometric ratio is between 1 and 40.",
  },

  "wheel-offset": {
    rimWidth: "Rim width",
    offset: "Offset (ET)",
    offsetHint:
      "In millimetres. Positive means the mounting face is outboard, so the wheel sits further in.",
    referenceWidth: "Width of the other rim",
    referenceHint: "For comparison. Leave empty if you are not comparing two wheels.",
    referenceOffset: "Offset of the other rim",
    results: "Result",
    rimWidthMm: "Rim width in millimetres",
    backspace: "Backspace",
    backspaceIn: "Backspace in inches",
    frontSpace: "Front space",
    outerFaceShift: "Outer rim edge movement",
    innerFaceShift: "Inner rim edge movement",
    shiftNote:
      "Both movements are outward — positive means further from the car. Whether an edge meets a " +
      "strut or a wing is not in this calculation.",
    formulaLine: "backspace = W/2 + ET     front space = W/2 − ET",
    inputs: "Entered",
    unitMm: "mm",
    unitIn: "in",
    errorWidth: "The rim width is between 3 and 20 inches.",
    errorOffset: "The offset is between −120 and 150 mm.",
    errorReference: "For a comparison, enter both the width and the offset of the other rim, or neither.",
  },
} as const;
