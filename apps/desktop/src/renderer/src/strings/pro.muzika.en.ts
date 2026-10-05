/**
 * „Muzika i produkcija" — the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.en.ts`.
 *
 * **A unit is copy, not a constant.** Written here rather than concatenated
 * in the surface, so a unit hard-coded in a component is not a string
 * `check:strings` cannot see and a translator cannot find.
 *
 * **`speaker-load` and `spl-distance` are `life-safety`.** Their copy may
 * name a quantity and may name the user's own limit, and may not say what
 * the two mean together. No verdict word appears anywhere in this file for
 * either tool, on purpose — see `toolForbidsVerdict`.
 *
 * **`cents-ratio` kept its own entry, against this file's first draft.** That
 * draft retired it as absorbed by `note-frequency` (a second frequency, a
 * cents shift) and `varispeed-repitch` (a cents entry point). Two things make
 * that wrong. `note-frequency` can only reach the identity through a NOTE —
 * there is no way in it to ask what ratio 700 cents is, or how many cents 3:2
 * is, because both of `centsRatio`'s other entry kinds need no pitch at all.
 * And `varispeed-repitch`, which does cover the bare conversion, is
 * `packs: ["muzika"]` while this tool is `["muzika", "prosveta"]` — so for a
 * teacher the identity would have been unreachable, and even for an engineer
 * it would have meant opening a tape-speed screen to look up an interval.
 * Nothing is duplicated by keeping it: all three call the same `centsRatio`.
 */
export const PRO_MUZIKA_EN = {
  "audio-level-reference": {
    entryKind: "What is entered",
    entryDbu: "dBu",
    entryDbv: "dBV",
    entryVrms: "RMS voltage (Vrms)",
    entryVpp: "Peak-to-peak voltage (Vpp)",
    entryDbm: "dBm",
    entryDbfs: "dBFS",
    value: "Value",
    impedance: "Reference impedance for dBm",
    impedanceHint: "600 Ω for a classic line, 50 Ω for RF. Without it dBm is not shown.",
    calibrationKind: "Digital scale alignment",
    calibrationNone: "Not entered",
    calibrationDbuAt0: "dBu at 0 dBFS",
    calibrationDbfsAtPlus4: "dBFS at +4 dBu",
    calibrationValue: "Alignment value",
    calibrationHint:
      "A house convention: +4 dBu at −18 dBFS is the EBU/SMPTE music convention, −20 dBFS is the SMPTE film convention. Nexus assumes neither.",

    results: "Result",
    resultDbu: "dBu",
    resultDbv: "dBV",
    resultVrms: "RMS voltage",
    resultVpeak: "Peak voltage",
    resultVpp: "Peak-to-peak voltage",
    resultDbm: "dBm",
    resultDbfs: "dBFS",
    dbmNote: "dBm and dBu coincide only at 600 Ω — outside that impedance they are different scales.",
    peakNote:
      "Peak and peak-to-peak values hold for a sine signal; in programme material the crest factor is a property of the signal itself.",

    inputs: "Entered",
    formula:
      "dBu = 20·log₁₀(Vrms / √0.6)     dBV = 20·log₁₀(Vrms)     dBm = 10·log₁₀((Vrms²/R) / 0.001)     Vpeak = Vrms·√2     dBFS = dBu − dBu(0 dBFS)",

    errorDbu: "dBu is a number from −100 to +60.",
    errorDbv: "dBV is a number from −100 to +60.",
    errorVrms: "The RMS voltage must be greater than zero.",
    errorVpp: "The peak-to-peak voltage must be greater than zero.",
    errorDbm: "dBm is a number from −100 to +60.",
    errorImpedance: "The reference impedance must be greater than zero.",
    errorDbfs: "dBFS must be a real number, and the resulting dBu must stay in the range −100 to +60.",
    errorCalibration: "The alignment must give a dBu in the range −100 to +60.",

    unitDbu: "dBu",
    unitDbv: "dBV",
    unitV: "V",
    unitDbm: "dBm",
    unitDbfs: "dBFS",
    unitOhm: "Ω",
  },

  "bar-duration": {
    bpm: "Pace",
    bpmHint: "Beats per minute, according to the chosen reference below.",
    bpmReference: "What the tempo counts",
    bpmRefQuarter: "Quarter note",
    bpmRefDottedQuarter: "Dotted quarter",
    bpmRefDenominatorUnit: "The note value of the denominator",
    bpmReferenceHint:
      "In compound time signatures such as 6/8 the tempo is often given in dotted quarters — this tool does not assume that.",
    numerator: "Time signature numerator",
    denominator: "Time signature denominator",
    bars: "Number of bars",
    barsHint: "The last field entered — this one or the duration — drives the calculation; the other becomes calculated.",
    duration: "Duration",
    durationHint: "In seconds. The last field entered — this one or the number of bars — drives the calculation.",

    results: "Result",
    resultSeconds: "Duration",
    resultFormatted: "Duration (mm:ss)",
    resultSecondsPerBar: "Seconds per bar",
    resultSecondsPerBeatUnit: "Seconds per denominator unit",
    resultBars: "Whole number of bars",
    resultRemainderSeconds: "Remainder in seconds",
    resultRemainderBeats: "Remainder in denominator units",
    resultRemainderMs: "Remainder in milliseconds",

    inputs: "Entered",
    formula:
      "secPerUnit = (60/BPM)·(4/denominator)   [or /1.5 for a dotted quarter, or 60/BPM for the denominator unit]     secPerBar = numerator·secPerUnit     duration = bars·secPerBar     bars = floor(duration/secPerBar)",

    errorBpm: "Tempo is a number from 1 to 999.",
    errorNumerator: "The time signature numerator is a whole number from 1 to 64.",
    errorDenominator: "The time signature denominator must be 1, 2, 4, 8, 16 or 32.",
    errorBpmReference: "The tempo reference must be a chosen value.",
    errorBars: "The number of bars is a number from 0 to 100000.",
    errorSeconds: "The duration is a number from 0 to 10000000 seconds.",

    unitS: "s",
    unitBpm: "BPM",
    unitDoba: "beat",
    unitMs: "ms",
  },

  "bpm-delay-times": {
    bpm: "Pace",
    highlightDenominator: "Note value for the highlight",
    highlightModifier: "Highlight modifier",
    modStraight: "Plain",
    modDotted: "Dotted",
    modTriplet: "Triplet",

    resultsForward: "Table by tempo",
    colNote: "Note",
    colStraightMs: "Plain (ms)",
    colStraightHz: "Plain (Hz)",
    colDottedMs: "Dotted (ms)",
    colDottedHz: "Dotted (Hz)",
    colTripletMs: "Triplet (ms)",
    colTripletHz: "Triplet (Hz)",
    beatMs: "Duration of one quarter",

    measuredMs: "Measured delay",
    measuredMsHint: "From an external delay unit or an unknown stem, in milliseconds.",
    resultsInverse: "Table by measured delay",
    colStraightBpm: "Plain (BPM)",
    colDottedBpm: "Dotted (BPM)",
    colTripletBpm: "Triplet (BPM)",

    inputs: "Entered",
    formula:
      "ms = (60000/BPM)·(4/denominator)·modifier     modifier: plain=1, dotted=3/2, triplet=2/3     Hz = 1000/ms     reverse: BPM = 240000·modifier/(denominator·measuredMs)",

    errorBpm: "Tempo is a number from 1 to 999.",
    errorDenominator: "The highlight note value must be 1, 2, 4, 8, 16, 32 or 64.",
    errorMeasuredMs: "The measured delay must be greater than zero.",

    unitMs: "ms",
    unitHz: "Hz",
    unitBpm: "BPM",
  },

  "cents-ratio": {
    entryKind: "What is entered",
    entryFrequencies: "Two frequencies",
    entryCents: "Cents",
    entryRatio: "Ratio",
    frequencyA: "First frequency (A)",
    frequencyB: "Second frequency (B)",
    cents: "Cents",
    centsHint: "Signed, from −12000 to +12000. One equal-temperament semitone is 100 cents.",
    ratio: "Ratio",
    ratioHint: "As a number: 1.5 for a just fifth 3:2, 1.25 for a just third 5:4.",
    baseFrequency: "Base frequency",
    baseFrequencyHint: "Optional — gives the resulting frequency and the beat rate.",
    baseFrequencyFromA: "With two frequencies the base is A, so this field is not entered.",

    results: "Result",
    resultCents: "Cents",
    resultSemitones: "Semitones (12-TET)",
    resultRatio: "Ratio",
    resultBaseFrequency: "Base frequency",
    resultFrequency: "Resulting frequency",
    resultBeatHz: "Beat rate",
    beatNote:
      "The beat rate is a difference in hertz, not in cents — the same 7.85 cents is 3.6 Hz at 440 Hz and 90 Hz at 11 kHz.",
    signNote: "The sign is kept: a B below A gives negative cents and a ratio below one.",

    inputs: "Entered",
    formula: "cents = 1200·log₂(fB/fA)     ratio = 2^(cents/1200)     beats = |f·(ratio − 1)|",

    errorFrequencyA: "The first frequency must be greater than zero.",
    errorFrequencyB: "The second frequency must be greater than zero.",
    errorCents: "Cents is a number from −12000 to +12000.",
    errorRatio: "The ratio must be greater than zero.",
    errorBaseFrequency: "The base frequency must be greater than zero.",

    unitHz: "Hz",
    unitCent: "cents",
    unitSemitone: "semitones",
  },

  "compressor-curve": {
    threshold: "Threshold T",
    thresholdHint: "In dBFS, from −80 to 0.",
    ratio: "Ratio n:1",
    knee: "Knee width",
    kneeHint: "0 is a hard knee. Default 0.",
    inputLevel: "Input level x",
    inputLevelHint: "In dBFS, from −120 to +20.",
    makeup: "Makeup gain",
    makeupHint: "Default 0.",
    makeupReferenceLevel: "Reference level for makeup",
    makeupReferenceLevelHint:
      "The programme level the gain is returned to. Mastering returns to programme level, not full scale, so this has no default value.",

    results: "Result",
    resultOutputLevel: "Output level y",
    resultGainReduction: "Gain reduction",
    resultOutputWithMakeup: "Output after makeup gain",
    resultMakeupToReference: "Makeup that returns the reference level to itself",
    scopeNote:
      "This is only the static gain transfer curve — without attack, release, detector type (peak or RMS) and without look-ahead.",

    inputs: "Entered",
    formula:
      "below the knee: y=x     in the knee: y = x + (1/n − 1)·(x − T + W/2)²/(2W)     above the knee: y = T + (x − T)/n     GR = x − y",

    errorThreshold: "The threshold is a number from −80 to 0 dBFS.",
    errorRatio: "The ratio is a number from 1 to 1000.",
    errorKnee: "The knee width is a number from 0 to 40 dB.",
    errorInputLevel: "The input level is a number from −120 to +20 dBFS.",
    errorMakeup: "The makeup gain is a number from −20 to +40 dB.",
    errorMakeupReferenceLevel: "The reference level for makeup is a number from −120 to +20 dBFS.",

    unitDb: "dB",
    unitDbfs: "dBFS",
  },

  "decibel-ratio": {
    entryKind: "What is entered",
    entryDecibels: "Decibels",
    entryRatio: "Linear ratio",
    value: "Value",
    quantity: "Kind of quantity",
    quantityAmplitude: "Amplitude / voltage",
    quantityPower: "Power",

    results: "Result",
    resultDecibels: "Decibels",
    resultRatio: "Linear ratio",
    resultPercent: "Ratio in percent",

    levels: "List of levels to add",
    levelsHint: "One level per line, in decibels. Up to 64 lines.",
    resultsSum: "Incoherent sum",
    resultSum: "Sum",
    sumNote:
      "The sum is incoherent (by power) regardless of the chosen kind of quantity — coherent sources add by amplitude, which is a different question.",
    colLevel: "Level (dB)",
    colShare: "Share of energy (%)",

    inputs: "Entered",
    formula:
      "amplitude: dB = 20·log₁₀(ratio)     power: dB = 10·log₁₀(ratio)     sum: Lsum = 10·log₁₀(Σ 10^(Li/10))",

    errorDecibels: "Decibels is a number from −200 to +200.",
    errorRatio: "The linear ratio must be greater than zero.",
    errorQuantity: "The kind of quantity must be a chosen value.",
    errorLevels: "At least one and at most 64 levels are needed, each from −200 to +200 dB.",

    unitDb: "dB",
    unitPercent: "%",
  },

  "note-frequency": {
    entryKind: "What is entered",
    entryMidi: "MIDI number",
    entryName: "Note name",
    entryFrequency: "Frequency",
    midi: "MIDI number",
    midiHint: "A whole number from 0 to 127.",
    name: "Note name",
    nameHint: "Scientific notation: C, D#3, Bb-1, Fx2.",
    frequency: "Frequency",
    referencePitch: "Reference tone A4",
    referencePitchHint:
      "Default 440 Hz by ISO 16:1975. 415 Hz is the Baroque pitch, 442/443 Hz are common orchestral ones.",
    octaveConvention: "Octave numbering",
    octaveConventionScientific: "Scientific / MIDI (MIDI 60 = C4)",
    octaveConventionYamaha: "Yamaha (MIDI 60 = C3)",
    secondFrequency: "Second frequency",
    secondFrequencyHint: "Optional — prints the interval to this frequency.",
    pitchShiftCents: "Pitch shift in cents",
    pitchShiftCentsHint: "Optional, signed — applied to the calculated frequency.",

    results: "Result",
    resultName: "Name (sharps)",
    resultFlatName: "Name (flats)",
    resultMidi: "MIDI number",
    resultFrequency: "Frequency",
    outsideMidiRangeNote: "The calculated MIDI number is outside the range 0–127, shown as it is.",
    resultMidiExact: "Exact MIDI number (before rounding)",
    resultCents: "Deviation from the nearest note",

    intervalTitle: "Interval to the second frequency",
    resultIntervalCents: "Cents",
    resultIntervalSemitones: "Semitones (12-TET)",
    resultIntervalRatio: "Ratio",
    resultIntervalResultFrequency: "Resulting frequency",
    resultBeatHz: "Beat rate",

    shiftedTitle: "After the shift",
    resultShiftedName: "New note",
    resultShiftedFrequency: "New frequency",
    resultShiftedCents: "Deviation of the new note from the nearest",

    inputs: "Entered",
    formula:
      "f(m) = A4·2^((m−69)/12)     mExact = 69 + 12·log₂(f/A4)     cents = 1200·log₂(fB/fA)     shift: f' = f·2^(cents/1200)",

    errorMidi: "The MIDI number is a whole number from 0 to 127.",
    errorName: "The note name was not recognised in scientific notation.",
    errorFrequency: "The frequency must be greater than zero.",
    errorReferencePitch: "The reference tone is a number from 380 to 500 Hz.",
    errorOctaveConvention: "The octave numbering must be a chosen value.",
    errorSecondFrequency: "The second frequency must be greater than zero.",
    errorPitchShiftCents: "The pitch shift is a number from −12000 to +12000 cents.",

    unitHz: "Hz",
    unitCent: "cents",
    unitSemitone: "semitones",
  },

  "pcm-file-size": {
    direction: "Direction",
    directionFromDuration: "Duration → size",
    directionFromSize: "Size → duration",
    duration: "Duration",
    durationHint: "In seconds.",
    size: "Size",
    sizeUnit: "Size unit",
    sizeUnitMb: "MB",
    sizeUnitGb: "GB",
    sizeUnitMib: "MiB",
    sizeUnitGib: "GiB",
    sampleRate: "Sample rate",
    bitDepth: "Resolution",
    bitDepth32Note: "A 32-bit integer and a 32-bit float take the same 4 bytes.",
    channels: "Number of channels",
    tracks: "Number of tracks (session estimate)",
    tracksHint: "Default 1. The header is added per track, not once for the whole session.",
    includeHeader: "Include the 44-byte WAV header",
    yes: "Yes",
    no: "No",

    results: "Result",
    resultBytes: "Bytes",
    resultHeaderBytes: "Of which the header",
    resultMegabytes: "MB (decimal)",
    resultGigabytes: "GB (decimal)",
    resultMebibytes: "MiB (binary)",
    resultGibibytes: "GiB (binary)",
    resultBytesPerSecond: "Data rate (B/s)",
    resultBitrate: "Data rate",
    exceedsNote:
      "The total size exceeds what a 32-bit RIFF size field can address — RF64 or W64 is needed.",
    resultSeconds: "Duration",
    resultFormatted: "Duration (HH:MM:SS)",

    inputs: "Entered",
    formula:
      "bytesPerSecond = rate·(resolution/8)·channels     bytes = bytesPerSecond·duration·tracks + 44·tracks (with header)     rate[kbit/s] = rate·resolution·channels/1000",

    errorSampleRate: "The sample rate is a number from 1000 to 768000 Hz.",
    errorBitDepth: "The resolution must be 8, 16, 24 or 32 bits.",
    errorChannels: "The number of channels is a whole number from 1 to 256.",
    errorTracks: "The number of tracks is a whole number from 1 to 1000.",
    errorSeconds: "The duration may not be negative.",
    errorBytes:
      "The size must be greater than zero and must contain at least the header when it is included.",

    unitB: "B",
    unitMb: "MB",
    unitGb: "GB",
    unitMib: "MiB",
    unitGib: "GiB",
    unitKbps: "kbit/s",
    unitS: "s",
    unitHz: "Hz",
  },

  "reverb-time": {
    volume: "Room volume",
    temperature: "Air temperature",
    temperatureHint: "Default 20 °C. Feeds the speed of sound.",
    surfaces: "Surfaces",
    surfacesHint:
      "One row per surface: area;α125;α250;α500;α1000;α2000;α4000. The coefficients come from the specific product's label, per octave band, and apply to that range — Nexus does not build them in.",
    airAbsorption: "Air absorption per band (optional)",
    airAbsorptionHint:
      "m per metre, per octave band — depends on humidity and temperature. Above about 2 kHz in a large room it dominates.",
    air125: "125 Hz",
    air250: "250 Hz",
    air500: "500 Hz",
    air1000: "1000 Hz",
    air2000: "2000 Hz",
    air4000: "4000 Hz",

    results: "Result per band",
    colBand: "Band (Hz)",
    colAbsorption: "A (m² sabins)",
    colAverageAlpha: "ᾱ",
    colSabine: "Sabine (s)",
    colSabineWithAir: "Sabine with air (s)",
    colEyring: "Eyring (s)",
    totalArea: "Total area",
    speedOfSound: "Speed of sound",
    noValue: "no value",
    sabineLimitNote:
      "Sabine assumes a diffuse field and is unreliable above about ᾱ = 0.2 — that is why Eyring stands beside it.",
    divergenceNote:
      "At ᾱ = 1 Sabine still gives a finite number, while Eyring has no value — that difference is an honest answer, not an error.",

    inputs: "Entered",
    formula:
      "A = Σ(Sᵢ·αᵢ)     Sabine: RT60 = 24·ln(10)·V/(c·A)     Eyring: RT60 = 24·ln(10)·V/(−c·S·ln(1−ᾱ))     with air: RT60 = 24·ln(10)·V/(c·(A + 4mV))",

    errorTemperature: "The temperature is a number from −50 to +60 °C.",
    errorVolume: "The room volume must be greater than zero.",
    errorSurfaces:
      "At least one and at most 64 rows are needed; the area must be greater than zero, every α is a number from 0 to 1.",
    errorAirAbsorption: "Air absorption may not be negative.",

    unitS: "s",
    unitM2: "m²",
    unitM3: "m³",
    unitM: "m",
    unitMps: "m/s",
    unitHz: "Hz",
    unitC: "°C",
  },

  "room-modes": {
    length: "Room length",
    width: "Room width",
    height: "Room height",
    temperature: "Air temperature",
    temperatureHint: "Default 20 °C.",
    frequencyLimit: "Upper frequency limit",
    frequencyLimitHint:
      "Default 300 Hz — modes matter where the room is not diffuse.",
    maxOrder: "Highest mode order per axis",
    maxOrderHint: "Default 4.",

    results: "Modes",
    colIndex: "(p, q, r)",
    colFrequency: "Frequency (Hz)",
    colType: "Kind",
    colSpacing: "Gap to the previous (Hz)",
    typeAxial: "axial",
    typeTangential: "tangential",
    typeOblique: "oblique",
    speedOfSound: "Speed of sound",
    idealizationNote:
      "Modes for a rectangular room with rigid walls — an idealisation, not a specific room with doors, windows and furniture.",

    inputs: "Entered",
    formula:
      "f(p,q,r) = (c/2)·√((p/L)² + (q/W)² + (r/H)²)     type: 1 axis = axial, 2 = tangential, 3 = oblique",

    errorLength: "The room length is a number from 0.5 to 100 m.",
    errorWidth: "The room width is a number from 0.5 to 100 m.",
    errorHeight: "The room height is a number from 0.5 to 30 m.",
    errorTemperature: "The temperature is a number from −50 to +60 °C.",
    errorFrequencyLimit: "The upper frequency limit is a number from 20 to 1000 Hz.",
    errorMaxOrder: "The highest mode order is a whole number from 1 to 8.",

    unitHz: "Hz",
    unitM: "m",
    unitMps: "m/s",
  },

  "sample-buffer-latency": {
    sampleRate: "Sample rate",
    bufferSamples: "Buffer size",
    extraInMs: "Additional input latency (AD/driver)",
    extraInMsHint: "From the interface's specification. Without it, zero is not assumed.",
    extraOutMs: "Additional output latency (DA/driver)",
    extraOutMsHint: "From the interface's specification. Without it, zero is not assumed.",

    resultsBuffer: "Buffer latency",
    resultOneWayMs: "One direction (buffer only)",
    resultBufferRoundTripMs: "Both directions (buffer only)",
    resultOneWayInMs: "One direction, input",
    resultOneWayOutMs: "One direction, output",
    resultRoundTripMs: "Both directions, total",
    theoreticalNote:
      "This is the theoretical minimum. Driver safety buffers and the offset of the USB/Thunderbolt transfer are not derived and stay outside the model.",

    msToSamples: "Duration",
    msToSamplesHint:
      "In milliseconds. The last field entered — this one or the sample count — drives the calculation.",
    samplesInput: "Sample count",
    samplesInputHint: "The last field entered — this one or the duration — drives the calculation.",
    resultsConvert: "Samples and duration",
    resultSamples: "Samples",
    wholeSamplesNote:
      "The duration does not fall exactly on a sample boundary — a fractional number is shown, not rounded.",
    resultMilliseconds: "Duration",

    inputs: "Entered",
    formula:
      "oneWay = buffer/rate·1000     bothWays = 2·oneWay + extraIn + extraOut     samples = ms/1000·rate     ms = samples/rate·1000",

    errorSampleRate: "The sample rate is a number from 1000 to 768000 Hz.",
    errorBufferSamples: "The buffer size is a whole number from 1 to 65536.",
    errorExtraInMs: "The additional input latency is a number from 0 to 100 ms.",
    errorExtraOutMs: "The additional output latency is a number from 0 to 100 ms.",
    errorMilliseconds: "The duration must be greater than zero.",
    errorSamples: "The sample count may not be negative.",

    unitMs: "ms",
    unitHz: "Hz",
    unitSamples: "samples",
  },

  "scale-chord-speller": {
    root: "Root note",
    rootHint: "A letter C–B, with #, ##, b or bb. Without an octave.",
    kind: "Kind",
    kindScale: "Scale",
    kindChord: "Chord",
    scaleType: "Scale kind",
    scaleMajor: "Major (Ionian)",
    scaleNaturalMinor: "Natural minor (Aeolian)",
    scaleHarmonicMinor: "Harmonic minor",
    scaleMelodicMinor: "Melodic minor (ascending)",
    scaleDorian: "Dorian",
    scalePhrygian: "Phrygian",
    scaleLydian: "Lydian",
    scaleMixolydian: "Mixolydian",
    scaleLocrian: "Locrian",
    scaleMajorPentatonic: "Major pentatonic",
    scaleMinorPentatonic: "Minor pentatonic",
    scaleBlues: "Blues",
    chordType: "Chord kind",
    chordMaj: "major",
    chordMin: "minor",
    chordDim: "diminished",
    chordAug: "augmented",
    chordSus2: "sus2",
    chordSus4: "sus4",
    chord6: "6",
    chordM6: "m6",
    chord7: "7 (dominant)",
    chordMaj7: "maj7",
    chordM7: "m7",
    chordM7b5: "m7b5",
    chordDim7: "dim7",
    chord9: "9",
    chordM9: "m9",
    chordMaj9: "maj9",
    chord11: "11",
    chord13: "13",

    results: "Notes",
    colDegree: "Degree",
    colNote: "Note",
    colSemitones: "Semitones from the root",
    unspellableCell: "unspellable",
    unspellableNote:
      "Unspellable in this notation without an enharmonic respelling — it is not shown under another name.",

    keySignatureTitle: "Key signature",
    resultSharps: "Sharps",
    resultFlats: "Flats",
    keyNone: "none — the scale has no key signature of its own",
    mixedNote: "This scale does not correspond to a key signature — the accidentals are mixed, written per note.",
    relativeNote: "This is the key signature of the parent major key, not this scale's own.",

    triadsTitle: "Triads on the degrees",
    colTriadDegree: "Degree",
    colTriadNotes: "Notes",
    colTriadQuality: "Kind",
    qualityMajor: "major",
    qualityMinor: "minor",
    qualityDiminished: "diminished",
    qualityAugmented: "augmented",
    qualityUnnamed: "unnamed",

    inputs: "Entered",
    formula:
      "pc = mod12(rootPc + semitones_i)     letter_i = root + letterStep_i     accidental = mod12(pc − naturalPC + 6) − 6     triad: qualities from the intervals (4,3) major, (3,4) minor, (3,3) diminished, (4,4) augmented",

    errorRoot: "The root note was not recognised — a letter C–B, with at most two #, ## or b, bb.",
    errorScale: "The scale kind must be a chosen value.",
    errorChord: "The chord kind must be a chosen value.",
  },

  "sound-wavelength": {
    entryKind: "What is entered",
    entryFrequency: "Frequency",
    entryWavelength: "Wavelength",
    value: "Value",
    temperature: "Air temperature",
    temperatureHint:
      "Default 20 °C. The model is dry air — humidity shifts the speed of sound by less than 1%.",
    distance: "Distance",
    distanceHint: "Optional — gives the delay at that distance.",
    speedOverride: "Measured speed of sound",
    speedOverrideHint:
      "Optional — replaces the dry-air model, for someone who has measured their own medium.",

    results: "Result",
    resultSpeedOfSound: "Speed of sound",
    resultFrequency: "Frequency",
    resultWavelength: "Wavelength",
    resultWavelengthCm: "Wavelength (cm)",
    resultHalfWavelength: "Half the wavelength",
    resultQuarterWavelength: "Quarter of the wavelength",
    resultDelayPerMetre: "Delay per metre",
    resultDelay: "Delay at the distance",

    inputs: "Entered",
    formula:
      "c(T) = 331.3·√(1 + T/273.15)     λ = c/f     f = c/λ     delay = distance/c·1000",

    errorFrequency: "The frequency must be greater than zero.",
    errorWavelength: "The wavelength must be greater than zero.",
    errorTemperature: "The temperature is a number from −50 to +60 °C.",
    errorDistance: "The distance may not be negative.",
    errorSpeedOverride: "The measured speed of sound must be greater than zero.",

    unitM: "m",
    unitCm: "cm",
    unitMs: "ms",
    unitHz: "Hz",
    unitMps: "m/s",
    unitC: "°C",
  },

  "speaker-load": {
    cabinets: "Speakers",
    cabinetsHint:
      "One row per speaker: impedance;group. The group is required only for series-parallel wiring, numbers 1–8.",
    wiring: "Wiring",
    wiringParallel: "Parallel",
    wiringSeries: "Series",
    wiringSeriesParallel: "Series-parallel (by group)",
    power: "Amplifier power into the resulting load",
    powerHint: "From the amplifier's power table for the resulting impedance. Never assumed.",
    minimumLoad: "Lowest impedance the amplifier tolerates",
    minimumLoadHint:
      "From your amplifier's specification. Nexus does not know that number and offers no value.",

    results: "Result",
    resultTotalImpedance: "Total impedance",
    resultDriveVoltage: "Drive voltage",
    colCabinet: "Speaker",
    colImpedance: "Impedance",
    colShare: "Share of power (%)",
    colPower: "Power (W)",
    limitLabel: "Your lowest impedance",
    ratioLabel: "Total impedance ÷ your limit",
    modelNote:
      "The model is the nominal resistive impedance from the cabinet's label, not the speaker's real reactive curve — which nobody can type in.",

    inputs: "Entered",
    formula:
      "parallel: 1/Ztotal = Σ(1/Zᵢ)     series: Ztotal = ΣZᵢ     series-parallel: add within a group, then parallel across groups     V = √(P·Ztotal)     parallel branch: Pᵢ = V²/Zᵢ     series branch: Pᵢ = I²·Zᵢ, I = V/Ztotal",

    errorCabinets: "At least one and at most 32 speakers are needed.",
    errorImpedance: "Every speaker's impedance must be greater than zero.",
    errorGroup: "The group is required for series-parallel wiring, a whole number from 1 to 8.",
    errorPower: "Power must be greater than zero.",
    errorMinimumLoad: "The lowest impedance must be greater than zero.",

    unitOhm: "Ω",
    unitW: "W",
    unitV: "V",
    unitPercent: "%",
  },

  "spl-distance": {
    sensitivity: "Sensitivity",
    sensitivityReference: "Sensitivity reference",
    sensitivityReference1w: "1 W / 1 m",
    sensitivityReference283v: "2.83 V / 1 m",
    nominalImpedance: "Nominal cabinet impedance",
    nominalImpedanceHint: "Required when the reference is 2.83 V — 2.83 V is 1 W only at 8 Ω.",
    power: "Applied power",
    distance: "Distance",
    referenceDistance: "Reference distance",
    referenceDistanceHint: "Default 1 m — the distance at which the sensitivity was measured.",
    secondDistance: "Second distance",
    secondDistanceHint: "Optional — for the difference relative to the first distance.",
    limit: "Your level limit",
    limitHint: "From the regulation you apply. Nexus does not know which regulation that is and offers no value.",

    results: "Result",
    resultSensitivity1W: "Sensitivity referred to 1 W/1 m",
    resultLevel: "Level at the distance",
    resultPowerTerm: "Power contribution",
    resultDistanceLoss: "Loss with distance",
    resultSecondLevel: "Level at the second distance",
    resultSecondDifference: "Difference between the distances",
    resultLimitDifference: "Difference in dB",
    ratioLabel: "Pressure ratio",
    freeFieldNote:
      "The model is a point source in free space. Indoors the reverberant field stops the inverse-square law after the critical distance; directivity, array coupling, air absorption and cabinet power compression are outside the model.",

    inputs: "Entered",
    formula:
      "SPL(d) = sensitivity + 10·log₁₀(P) − 20·log₁₀(d/dref)     difference = −20·log₁₀(d2/d1)     sensitivity_1W = sensitivity_2.83V − 10·log₁₀(8/Z)",

    errorSensitivity: "The sensitivity is a number from 70 to 120 dB SPL.",
    errorSensitivityReference: "The sensitivity reference must be a chosen value.",
    errorNominalImpedance: "The nominal impedance must be greater than zero when the reference is 2.83 V.",
    errorPower: "The applied power must be greater than zero.",
    errorDistance: "The distance must be greater than zero.",
    errorReferenceDistance: "The reference distance must be greater than zero.",
    errorSecondDistance: "The second distance must be greater than zero.",
    errorLimit: "The level limit is a number from 0 to 140 dB.",

    unitDb: "dB",
  },

  transposition: {
    mode: "Input kind",
    modeText: "Text — notes and chords without octaves",
    modePitch: "A single note with an octave",
    text: "Text",
    textHint:
      "One or more lines, up to 5000 characters. Spaces and bar lines (|) are preserved. Only the chord root and the bass after a slash are transposed — the rest of the chord (m7, sus4...) is copied unchanged.",
    pitchName: "Note",
    pitchNameHint: "Scientific notation with an octave, e.g. C4, Bb-1, F##3.",
    octaveShift: "Octave shift",
    octaveShiftHint:
      "Default 0. For members of the octave-transposing family — contrabass clarinet, baritone saxophone and the like.",
    byKind: "Transposition method",
    byKindInterval: "Interval",
    byKindInstrument: "Instrument pair",
    interval: "Interval",
    intervalUnison: "perfect unison",
    intervalMinorSecond: "minor second",
    intervalMajorSecond: "major second",
    intervalMinorThird: "minor third",
    intervalMajorThird: "major third",
    intervalPerfectFourth: "perfect fourth",
    intervalAugmentedFourth: "augmented fourth",
    intervalDiminishedFifth: "diminished fifth",
    intervalPerfectFifth: "perfect fifth",
    intervalMinorSixth: "minor sixth",
    intervalMajorSixth: "major sixth",
    intervalMinorSeventh: "minor seventh",
    intervalMajorSeventh: "major seventh",
    intervalOctave: "octave",
    direction: "Direction",
    directionUp: "Up",
    directionDown: "Down",
    instrument: "Instrument",
    instrumentBb: "B (in Bb)",
    instrumentA: "A (in A)",
    instrumentEbAlto: "Eb alto/baritone (sounds lower)",
    instrumentEbSopranino: "Eb sopranino/cornet (sounds higher)",
    instrumentF: "F (in F)",
    instrumentDirection: "Direction",
    instrumentDirectionWrittenToSounding: "Written → sounds",
    instrumentDirectionSoundingToWritten: "Sounds → written",

    resultsText: "Transposed",
    resultText: "Text",
    resultUnspellable: "Unspellable notes",
    unspellableNote:
      "Notes that would need more than a double accidental stay written as in the source.",

    resultsPitch: "Result",
    resultName: "New note",
    resultOctave: "Octave",
    resultMidi: "MIDI number",
    pitchUnspellableNote:
      "Needs more than a double accidental — unspellable without an enharmonic respelling.",

    sourceKeyTitle: "Starting key (optional)",
    sourceKey: "Tonic",
    sourceKeyHint:
      "Without an octave, e.g. Eb or F#. Only when entered is the resulting key shown.",
    sourceKeyMode: "Kind",
    sourceKeyModeMajor: "Major",
    sourceKeyModeMinor: "Minor",
    enharmonicPreference: "Enharmonic spelling of the result",
    enharmonicSource: "Keep the source direction",
    enharmonicSharps: "Prefer sharps",
    enharmonicFlats: "Prefer flats",
    resultKeyTonic: "Resulting key",
    resultKeySharps: "Sharps",
    resultKeyFlats: "Flats",
    keyUnspellableNote: "The resulting key cannot be written without a triple accidental.",

    inputs: "Entered",
    formula:
      "up: newLetter = letter + intervalStep, newPC = mod12(pc + semitones)     down: the reverse     accidental = mod12(newPC − naturalPC + 6) − 6     instrument: written sounds lower or higher by the instrument's interval, depending on the instrument",

    errorText: "The text must have from 1 to 5000 characters.",
    errorInterval: "The interval must be a chosen value.",
    errorDirection: "The direction must be a chosen value.",
    errorInstrument: "The instrument must be a chosen value.",
    errorName: "The note was not recognised in scientific notation with an octave.",
    errorOctaveShift: "The octave shift is a whole number from −3 to +3.",
    errorTonic: "The tonic was not recognised.",
    errorMode: "The kind of key must be a chosen value.",
    errorEnharmonicPreference: "The enharmonic spelling must be a chosen value.",
  },

  "varispeed-repitch": {
    entryKind: "What is entered",
    entrySemitones: "Shift in semitones",
    entryCents: "Shift in cents",
    entryRatio: "Speed ratio",
    entrySampleRates: "Sample-rate pair",
    value: "Value",
    recordedAtHz: "Recorded at",
    playedBackAtHz: "Played back at",
    recordedAtHzHint:
      "r = playback/recorded. A file recorded at 48000 Hz played in a 44100 Hz session is a common studio case.",
    originalTempo: "Source tempo",
    originalTempoHint: "Optional — gives the resulting tempo.",
    originalLength: "Source length",
    originalLengthHint: "Optional, in seconds — gives the resulting length.",

    results: "Result",
    resultRatio: "Speed ratio",
    resultSemitones: "Shift in semitones",
    resultCents: "Shift in cents",
    resultTempo: "Resulting tempo",
    resultLength: "Resulting length",
    resultLengthFormatted: "Resulting length (mm:ss)",
    speedNote: "Pitch and speed go together — this is resampling, not time stretching.",

    inputs: "Entered",
    formula:
      "r = 2^(semitones/12) = 2^(cents/1200) = playback/recorded     newTempo = tempo·r     newLength = length/r",

    errorSemitones: "The shift is a number from −48 to +48 semitones.",
    errorCents: "The shift is a number from −12000 to +12000 cents.",
    errorRatio: "The speed ratio must be greater than zero.",
    errorRecordedAtHz: "The recording rate is a number from 1000 to 768000 Hz.",
    errorPlayedBackAtHz: "The playback rate is a number from 1000 to 768000 Hz.",
    errorTempo: "The source tempo is a number from 1 to 999 BPM.",
    errorLengthSeconds: "The source length must be greater than zero.",

    unitSemitone: "semitones",
    unitCent: "cents",
    unitBpm: "BPM",
    unitS: "s",
    unitHz: "Hz",
  },
} as const;
