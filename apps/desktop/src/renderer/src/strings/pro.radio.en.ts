/**
 * „Radio-amaterizam" — the English copy of this toolkit's surfaces.
 *
 * The mirror of `pro.radio.ts`, key for key. The same rules hold: no band plan,
 * no licence class and no power limit is quoted, and the velocity factor, the
 * datasheet's dB/100 m and the path loss are the user's own figures.
 */
export const PRO_RADIO_EN = {
  "frequency-wavelength": {
    known: "Given as",
    knownFrequency: "Frequency",
    knownWavelength: "Wavelength",
    frequency: "Frequency",
    frequencyHint: "In hertz. Leave it empty if that is the answer you want.",
    wavelength: "Wavelength",
    wavelengthHint: "In metres, in free space. Leave it empty if that is the answer you want.",

    results: "Result",
    outFrequency: "Frequency",
    outFrequencyKhz: "Frequency in kHz",
    outFrequencyMhz: "Frequency in MHz",
    outWavelength: "Wavelength",
    outHalf: "Half wavelength",
    outQuarter: "Quarter wavelength",

    formula:
      "λ = c/f, c = 299 792 458 m/s (exact by the SI). This is the free-space length — the " +
      "physical antenna is shorter, which is what the antenna-lengths tool is for, taking the " +
      "velocity factor as an input.",

    errorPair: "Enter exactly one of the two — a frequency or a wavelength.",
    errorFrequency: "The frequency is between 1 Hz and 1 THz.",
    errorWavelength: "The wavelength is a positive number of metres.",

    unitHz: "Hz",
    unitKhz: "kHz",
    unitMhz: "MHz",
    unitM: "m",
  },

  "antenna-lengths": {
    frequency: "Frequency",
    frequencyHint: "In hertz.",
    velocityFactor: "Velocity factor",
    velocityFactorHint:
      "0.1–1. It is 1 in air, about 0.95 for wire and about 0.66 for coaxial cable. There is no " +
      "default — it is a property of the conductor being cut.",

    results: "Result",
    outWavelength: "Free-space wavelength",
    outConductor: "Wavelength in the conductor",
    outDipole: "Half-wave dipole",
    outQuarter: "Quarter-wave element",
    outDipoleFt: "Dipole in feet",
    outQuarterFt: "Quarter-wave element in feet",

    formula:
      "λ = VF·c/f; dipole = λ/2, quarter-wave = λ/4. The end effect from the conductor's thickness " +
      "and its height above ground is not included — an antenna is trimmed on a meter.",

    errorFrequency: "The frequency is between 1 Hz and 1 THz.",
    errorVelocityFactor: "The velocity factor is between 0.1 and 1.",

    unitHz: "Hz",
    unitM: "m",
    unitFt: "ft",
  },

  "swr-match": {
    known: "Given as",
    knownSwr: "SWR",
    knownReturnLoss: "Return loss",
    knownReflection: "Reflection coefficient",
    knownMismatchLoss: "Mismatch loss",
    value: "Value",
    valueHint:
      "SWR from 1 up, return loss in dB, a reflection coefficient from 0 to 1, or a loss in dB.",

    results: "Result",
    outSwr: "SWR",
    outReturnLoss: "Return loss",
    outReflection: "Reflection coefficient",
    outReflectedPercent: "Reflected",
    outPowerDelivered: "Power delivered",
    outMismatchLoss: "Mismatch loss",
    returnLossNone: "none (a perfect match)",

    formula:
      "|Γ| = (SWR − 1)/(SWR + 1); return loss = −20·log₁₀|Γ|; power delivered = 1 − |Γ|²; " +
      "mismatch loss = −10·log₁₀(1 − |Γ|²).",

    errorKind: "Choose the quantity that was given.",
    errorValue:
      "That value cannot be one: SWR is 1 or more, a reflection coefficient runs from 0 to 1, and " +
      "the losses are non-negative.",

    unitDb: "dB",
    unitPercent: "%",
  },

  "path-loss": {
    distance: "Distance",
    distanceHint: "Between the antennas, in kilometres.",
    frequency: "Frequency",
    frequencyHint: "In hertz.",

    results: "Result",
    outLoss: "Free-space path loss",
    outFraction: "Share of power that arrives",
    outWavelength: "Wavelength",

    formula:
      "L = 20·log₁₀(4πd/λ) — the Friis transmission equation (Friis 1946; ITU-R P.525 states it as " +
      "the free-space basic transmission loss). Free space means no ground reflection, no " +
      "diffraction, no atmospheric absorption and no rain.",

    errorDistance: "The distance is a positive number of kilometres.",
    errorFrequency: "The frequency is between 1 Hz and 1 THz.",

    unitDb: "dB",
    unitKm: "km",
    unitM: "m",
    unitPercent: "%",
    unitHz: "Hz",
  },

  "fresnel-zone": {
    path: "Path length",
    pathHint: "The whole distance between the antennas, in kilometres.",
    fromEnd: "Distance from one end",
    fromEndHint: "From the first antenna to the obstruction, in kilometres.",
    frequency: "Frequency",
    frequencyHint: "In hertz.",

    results: "Result",
    outRadius: "First Fresnel zone radius",
    outClearance: "60 % clearance",
    outWavelength: "Wavelength",
    outToEnd: "To the far end",

    formula:
      "r₁ = √(λ·d₁·d₂/(d₁ + d₂)) — the first zone (ITU-R P.530). The radius is largest at the " +
      "midpoint; the 60 % clearance is the usual rule of thumb and not a limit this tool sets.",

    errorPath: "The path length is a positive number of kilometres.",
    errorFromEnd: "The distance to the obstruction must be less than the whole path.",
    errorFrequency: "The frequency is between 1 Hz and 1 THz.",

    unitKm: "km",
    unitM: "m",
    unitHz: "Hz",
  },

  "coax-loss": {
    dbPer100m: "Cable attenuation",
    dbPer100mHint:
      "From the manufacturer's data, in dB per 100 m — at the frequency you are using. There is " +
      "no cable table here.",
    length: "Cable length",
    lengthHint: "In metres.",
    inputWatts: "Power at the input",
    inputWattsHint: "In watts. Empty means the loss alone is reported.",

    results: "Result",
    outLoss: "Loss in the cable",
    outFraction: "Share of power that arrives",
    outLossPercent: "Lost",
    outOutputWatts: "Power at the far end",

    formula:
      "loss = (dB/100 m)·L/100; power fraction = 10^(−loss/10). The manufacturer's figure holds " +
      "for one stated frequency.",

    errorDbPer100m: "The cable attenuation is between 0 and 100 dB per 100 m.",
    errorLength: "The cable length is a positive number of metres.",
    errorPower: "The power is a positive number of watts.",

    unitDb: "dB",
    unitM: "m",
    unitPercent: "%",
    unitW: "W",
  },

  "link-budget": {
    txPower: "Transmitter power",
    txPowerHint: "In dBm.",
    txLoss: "Loss to the antenna",
    txLossHint: "Cable and connectors on the transmit side, in dB.",
    txGain: "Transmitting antenna gain",
    txGainHint: "In dBi.",
    rxLoss: "Loss from the antenna",
    rxLossHint: "Cable and connectors on the receive side, in dB.",
    rxGain: "Receiving antenna gain",
    rxGainHint: "In dBi.",
    pathLoss: "Path loss",
    pathLossHint: "In dB — take it from the path-loss tool or from your own calculation.",

    results: "Result",
    outEirp: "EIRP",
    outReceived: "Power at the receiver",
    outReceivedW: "Power at the receiver in watts",
    outReceivedUv: "Voltage into 50 Ω",
    outNetGain: "Net system gain",

    formula:
      "EIRP = P − loss + gain; received = EIRP + gain − loss − path loss; the voltage into 50 Ω is " +
      "√(P·R). The receiving threshold depends on the receiver and is not judged here.",

    errorTxPower: "The transmitter power is between −100 and 100 dBm.",
    errorLoss: "The losses are between 0 and 100 dB.",
    errorGain: "The gains are between −20 and 60 dBi.",
    errorPathLoss: "The path loss is between 0 and 400 dB.",

    unitDbm: "dBm",
    unitDbi: "dBi",
    unitDb: "dB",
    unitW: "W",
    unitUv: "µV",
  },
} as const;
