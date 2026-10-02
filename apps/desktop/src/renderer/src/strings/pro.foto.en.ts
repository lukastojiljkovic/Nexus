/**
 * „Fotografija i video" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells it. The
 * tool's NAME and its one-line blurb are not here — those live in a
 * different table another process owns.
 *
 * **Nothing in here judges.** Every tool in this pack is `riskClass: "none"`,
 * so none of them ever needed the „tvoja granica" phrasing `gradnja` uses —
 * there is no regulated limit in this pack for a value to sit beside.
 *
 * **A unit is copy, not a constant** — „mm", „m", „°" are written here rather
 * than concatenated in the surface.
 */
export const PRO_FOTO_EN = {
  "angle-of-view": {
    sensorWidth: "Sensor width",
    sensorWidthHint: "The actual width of the sensor's image area, not the format name.",
    sensorHeight: "Sensor height",
    focalLength: "Focal length",
    subjectDistance: "Distance to subject",
    subjectDistanceHint:
      "Optional. When entered, it also shows how much the frame covers at that distance.",

    results: "Result",
    horizontal: "Horizontal angle",
    vertical: "Vertical angle",
    diagonal: "Diagonal angle",
    sensorDiagonal: "Sensor diagonal",
    fieldWidth: "Covered width",
    fieldHeight: "Covered height",
    fieldDiagonal: "Covered diagonal",
    modelNote:
      "Calculated for a rectilinear (gnomonic) projection and a lens focused at infinity. Fisheye and macro distances do not follow this model.",

    inputs: "Entered",
    formula: "α = 2·arctan(d / 2f)     field = D·d / f",

    errorSensorWidth: "The sensor width must be between 0.5 and 200 mm.",
    errorSensorHeight: "The sensor height must be between 0.5 and 200 mm.",
    errorFocalLength: "The focal length must be between 0.5 and 5000 mm.",
    errorSubjectDistance: "The distance to the subject must be between 0.01 and 100000 m.",

    unitMm: "mm",
    unitM: "m",
    unitDeg: "°",
  },

  "crop-factor": {
    sensorWidth: "Sensor width",
    sensorHeight: "Sensor height",
    focalLength: "Focal length",
    focalLengthHint: "Optional — converted to the 135-format equivalent.",
    fNumber: "Aperture",
    fNumberHint: "Optional, independent of focal length — converted to the 135-format equivalent.",

    results: "Result",
    cropFactor: "Crop factor",
    sensorDiagonal: "Sensor diagonal",
    equivalentFocalLength: "Equivalent focal length (135)",
    equivalentAperture: "Equivalent aperture (135)",
    apertureNote:
      "The equivalence is by depth of field and total light through the aperture, not by exposure per area — N·crop is not a measured f-number.",

    inputs: "Entered",
    formula: "crop = 43.2666 mm / diagonal     f' = f·crop     N' = N·crop",

    errorSensorWidth: "The sensor width must be between 0.5 and 200 mm.",
    errorSensorHeight: "The sensor height must be between 0.5 and 200 mm.",
    errorFocalLength: "The focal length must be between 0.5 and 5000 mm.",
    errorFNumber: "The aperture must be between 0.5 and 256.",

    unitMm: "mm",
  },

  "depth-of-field": {
    focalLength: "Focal length",
    fNumber: "Aperture",
    focusDistance: "Focus distance",
    circleOfConfusion: "Circle of confusion",
    circleOfConfusionHint:
      "The viewing convention is chosen by you, not the tool — with no default. The help below suggests a number you can copy here.",

    results: "Result",
    hyperfocal: "Hyperfocal distance",
    nearLimit: "Near limit of sharpness",
    farLimit: "Far limit of sharpness",
    totalDepth: "Total depth of field",
    infinite: "infinity",
    modelNote:
      "Thin-lens model, distances from the front principal plane. The circle of confusion is the value you enter, not the tool's choice.",

    inputs: "Entered",
    formula: "H = f²/(N·c) + f     near = s·(H−f)/(H+s−2f)     far = s·(H−f)/(H−s)",

    helperTitle: "Help: circle of confusion from the diagonal",
    helperHint:
      "The “diagonal / divisor” convention — one of several possible. The result is a suggestion; it is not filled into the field above automatically.",
    helperDiagonal: "Sensor diagonal",
    helperDivisor: "Divisor",
    helperResult: "Suggested circle of confusion",

    errorFocalLength: "The focal length must be between 1 and 2000 mm.",
    errorFNumber: "The aperture must be between 0.5 and 256.",
    errorCircleOfConfusion: "The circle of confusion must be between 0.001 and 0.2 mm.",
    errorFocusDistance:
      "The focus distance must be greater than the focal length and within 0.01–100000 m.",
    errorHelperDiagonal: "The sensor diagonal must be between 1 and 200 mm.",
    errorHelperDivisor: "The divisor must be between 200 and 5000.",

    unitMm: "mm",
    unitM: "m",
  },

  "diffraction-limit": {
    fNumber: "Aperture",
    wavelengthNm: "Wavelength",
    wavelengthNmHint:
      "A physical choice of the light being examined — editable, and the result changes with it. 550 nm is green, the starting value.",
    sensorWidth: "Sensor width",
    pixelCount: "Number of pixels across",

    results: "Result",
    pixelPitch: "Pixel pitch",
    airyDiameter: "Airy disc diameter",
    ratio: "Disc ÷ pixel pitch",
    fNumberAtOnePitch: "Aperture at which the disc equals the pixel pitch",
    modelNote:
      "The tool prints numbers and passes no judgement on sharpness — the threshold at which diffraction becomes visible is an estimate, not a quantity.",

    inputs: "Entered",
    formula: "pitch = w/P     d = 2·(j₁₁/π)·λ·N     N₁ = pitch / (2·(j₁₁/π)·λ)",

    errorFNumber: "The aperture must be between 0.5 and 256.",
    errorWavelengthNm: "The wavelength must be between 380 and 780 nm.",
    errorSensorWidth: "The sensor width must be between 0.5 and 200 mm.",
    errorPixelCount: "The number of pixels must be a whole number between 1 and 1000000.",

    unitMm: "mm",
    unitUm: "μm",
    unitNm: "nm",
  },

  "exposure-equivalent": {
    n1: "Reference aperture N1",
    t1: "Reference shutter time t1",
    s1: "Reference sensitivity S1",
    shutterHint: "Seconds, or the form 1/x, for example 1/125.",
    n2: "Target aperture N2",
    targetHint:
      "Leave exactly one of the three target fields empty — it is calculated. Two empty or all three filled are refused.",
    t2: "Target shutter time t2",
    s2: "Target sensitivity S2",

    results: "Result",
    solvedField: "Calculated field",
    referenceEv100: "EV at ISO 100 (reference)",
    targetEv100: "EV at ISO 100 (target)",
    givenShiftStops: "Shift of the entered target fields (stops)",
    solvedMarker: "— calculated —",

    inputs: "Entered",
    formula: "N²/(t·S) = const     EV100 = log2(N²/t) − log2(S/100)",

    errorReferenceFNumber: "The reference aperture must be between 0.5 and 256.",
    errorReferenceShutter: "The reference shutter time must be between 1 μs and 3600 s.",
    errorReferenceIso: "The reference sensitivity must be between 6 and 4194304 ISO.",
    errorTargetFNumber: "The target aperture must be between 0.5 and 256.",
    errorTargetShutter: "The target shutter time must be between 1 μs and 3600 s.",
    errorTargetIso: "The target sensitivity must be between 6 and 4194304 ISO.",
    errorTargets: "Exactly one of the three target fields must be left empty.",

    unitS: "s",
  },

  "flash-guide-number": {
    guideNumber: "Guide number (at ISO 100)",
    guideNumberHint:
      "From your flash manual, for a particular zoom-head and reflector position — two guide numbers of the same flash at different zoom are not the same quantity.",
    guideNumberUnit: "Guide number unit",
    distance: "Flash-to-subject distance",
    iso: "Sensitivity",
    secondDistance: "Second distance",
    secondDistanceHint: "Optional — to compare illumination between two distances.",

    results: "Result",
    guideNumberAtIso: "Guide number at the entered ISO",
    fNumber: "Required aperture",
    secondFNumber: "Aperture at the second distance",
    distanceStops: "Change in illumination (stops)",
    modelNote:
      "The model is a bare point source in free space. Reflectors, modifiers, the zoom head and bounced light change the real number — the guide number is yours; the tool does not choose or check it.",

    inputs: "Entered",
    formula: "N = GN_S / d     GN_S = GN₁₀₀·√(S/100)     Δstops = 2·log2(d₂/d₁)",

    errorGuideNumber: "The guide number must be between 1 and 200 (in the entered unit).",
    errorDistance: "The distance must be between 0.05 and 200 m.",
    errorIso: "The sensitivity must be between 6 and 4194304 ISO.",
    errorSecondDistance: "The second distance must be between 0.05 and 200 m.",

    unitM: "m",
    unitFt: "ft",
  },

  "frame-rate-conform": {
    captureFps: "Recording frame rate",
    timelineFps: "Timeline frame rate",
    fpsHint:
      "Frames per second. For NTSC rates write a decimal point (23.976 — not a comma, which reads as a thousands separator).",
    sourceDuration: "Recording length (seconds)",
    clipLengthHint: "Leave empty if you enter the frame count below instead.",
    frameCount: "Frame count",
    slowMotionFactor: "Target slow-motion factor",
    slowMotionFactorHint:
      "Optional — how many times slower than real time. 5 means five times slower, and asks for the recording rate instead of assuming it.",

    results: "Result",
    speedPercent: "Playback speed",
    speedFactor: "Playback speed (factor)",
    conformedDuration: "Conformed duration",
    drift: "Offset relative to the original",
    requiredCaptureFps: "Required recording rate",
    modelNote: "Conforming does not change the frame count — only the timeline duration changes.",

    inputs: "Entered",
    formula: "Nf = round(fps_rec·L)     speed = fps_timeline/fps_rec     duration' = Nf/fps_timeline",

    errorCaptureFps: "The recording frame rate must be between 0.1 and 10000 fps.",
    errorTimelineFps: "The timeline frame rate must be between 0.1 and 10000 fps.",
    errorSourceDuration: "The recording length must be between 0.001 and 864000 s.",
    errorFrameCount: "The frame count must be a whole number between 1 and 100000000.",
    errorSlowMotionFactor: "The target slow-motion factor must be between 0.01 and 100.",
    errorClipLength: "Enter exactly one of recording length or frame count.",

    unitS: "s",
    unitFps: "fps",
  },

  "illuminance-to-aperture": {
    illuminance: "Illuminance",
    unit: "Unit",
    iso: "Sensitivity",
    isoShutterHint: "Needed only for the aperture below — the lx ↔ fc conversion does not depend on them.",
    shutter: "Shutter time",
    calibrationConstant: "Meter calibration constant C",
    calibrationConstantHint:
      "From your light meter's manual — around 250 for a flat receiver, around 340 for a dome. Neagle does not choose this value and offers no default.",

    results: "Result",
    lux: "Lux",
    footCandles: "Foot-candles",
    fNumber: "Required aperture",
    nearestThirdStop: "Nearest third-stop marking",
    modelNote:
      "The equation is for an incident measurement, flat or dome receiver — the constant K for reflected measurement is a different quantity and is not accepted here. The tool converts units and calculates the aperture; it passes no judgement on the illumination of a space.",

    inputs: "Entered",
    formula: "1 fc = 10.763910417 lx     N = √(E·S·t / C)",

    errorIlluminance: "The illuminance must be between 0.001 and 1000000.",
    errorCalibrationConstant: "The calibration constant must be between 100 and 800.",
    errorIso: "The sensitivity must be between 6 and 4194304 ISO.",
    errorShutter: "The shutter time must be between 1 μs and 3600 s.",

    unitLx: "lx",
    unitFc: "fc",
  },

  "mired-shift": {
    sourceTemperature: "Source colour temperature",
    targetTemperature: "Target temperature",
    targetTemperatureHint:
      "How far apart two temperatures are in mireds — use this or the shift below.",
    shift: "Mired shift",
    shiftHint:
      "Where a shift of the entered number of mireds brings the source temperature. Negative cools, positive warms.",

    results: "Result",
    sourceMired: "Source in mireds",
    resultMired: "Result in mireds",
    resultTemperature: "Resulting temperature",

    inputs: "Entered",
    formula: "M = 10⁶/T     ΔM = M₂ − M₁     T' = 10⁶/(M₁ + ΔM)",

    errorSourceTemperature: "The source temperature must be between 1000 and 40000 K.",
    errorTargetTemperature: "The target temperature must be between 1000 and 40000 K.",
    errorShift: "The mired shift must be between −500 and 500.",
    errorTarget: "Enter a target temperature or a mired shift.",

    unitMired: "MK⁻¹",
    unitK: "K",
  },

  "motion-blur": {
    speed: "Subject speed",
    speedUnit: "Speed unit",
    subjectDistance: "Distance to subject",
    focalLength: "Focal length",
    shutter: "Shutter time",
    shutterHint: "Leave empty to calculate the shutter time for the allowed blur below.",
    sensorWidth: "Sensor width",
    pixelCount: "Number of pixels across",
    acceptableBlurPixels: "Allowed blur",
    acceptableBlurPixelsHint: "Used only when the shutter-time field is empty.",

    results: "Result",
    blurMillimetres: "Blur on the sensor",
    blurPixels: "Blur in pixels",
    solvedShutter: "Required shutter time",
    modelNote:
      "Thin-lens model, distance from the front principal plane, motion across the optical axis. Motion towards the camera changes size, not position, and is not covered.",
    roundingNote:
      "The denominator is rounded UP, to a faster shutter — the value shown never allows more blur than was asked for.",

    inputs: "Entered",
    formula: "Δx = v·t     dImage = Δx·f/(D−f)     blurPx = dImage·P/w",

    errorFocalLength: "The focal length must be between 0.5 and 5000 mm.",
    errorSensorWidth: "The sensor width must be between 0.5 and 200 mm.",
    errorPixelCount: "The number of pixels must be a whole number between 1 and 1000000.",
    errorSubjectDistance: "The distance must be greater than the focal length and within 0.05–100000 m.",
    errorSpeed: "The speed must be greater than zero and within the allowed range.",
    errorShutter: "The shutter time must be between 1 μs and 3600 s.",
    errorAcceptableBlurPixels: "The allowed blur must be between 0.1 and 1000 px.",
    errorMode: "Enter a shutter time or an allowed blur.",

    unitMm: "mm",
    unitM: "m",
    unitS: "s",
    unitMs: "m/s",
    unitKmh: "km/h",
  },

  "nd-filter-exposure": {
    baseShutter: "Shutter time without filters",
    shutterHint: "Seconds, or the form 1/x, for example 1/125.",
    filterSlot: "Filter",
    slotHint:
      "Enter exactly one of the three fields per filter — stops, density or factor. An empty filter is not counted in the series. The list of filters exists only while the screen is open.",
    stops: "Stops",
    density: "Optical density D",
    factor: "Factor F",

    results: "Result",
    shutter: "Exposure time after the filters",

    inputs: "Entered",
    formula: "stops = Σ stopsᵢ     F = 2^stops     D = stops·log10(2)     t' = t·F",

    errorBaseShutter: "The shutter time without filters must be between 1 μs and 3600 s.",
    errorFilters: "Enter at least one filter.",
    errorFilterForm: "Enter exactly one of stops, density or factor per filter.",
    errorStops: "The stops per filter must be between 0 and 24.",
    errorDensity: "The optical density per filter must be between 0 and 7.5.",
    errorFactor: "The factor per filter must be between 1 and 16777216.",

    unitS: "s",
  },

  "pq-nits": {
    signal: "Normalised PQ signal",
    targetHint:
      "Enter exactly one of the signal, code value or luminance — the other two are calculated from it.",
    code: "Code value",
    luminance: "Luminance",
    range: "Range",
    rangeNarrow: "Narrow (video)",
    rangeFull: "Full",
    bitDepth: "Bit depth",

    results: "Result",
    codeNarrow: "Code (narrow range)",
    codeFull: "Code (full range)",
    modelNote:
      "The tool converts numbers by the ST 2084 curve and claims nothing about whether any material complies with any delivery standard.",

    inputs: "Entered",
    formula: "Y = 10000·(max(N^(1/m2)−c1,0)/(c2−c3·N^(1/m2)))^(1/m1)",

    errorSignal: "The PQ signal must be between 0 and 1.",
    errorLuminance: "The luminance must be between 0 and 10000 cd/m².",
    errorCode: "The code value must be a whole number within the range for the chosen depth and range.",
    errorTarget: "Enter exactly one of the signal, code value or luminance.",

    unitNits: "cd/m²",
  },

  "raster-image-size": {
    width: "Width",
    height: "Height",
    channels: "Number of channels",
    channelsHint: "1 greyscale, 3 RGB, 4 RGBA, more for extra channels.",
    bitDepth: "Bit depth per channel",
    layers: "Number of layers or frames",
    capacityValue: "Available space",
    capacityHint: "Optional — how many such files fit in the given space.",
    capacityUnit: "Space unit",
    averageFileSizeMb: "Known average file size (MB)",
    averageFileSizeMbHint:
      "Optional — used instead of the calculated size when counting how many fit.",

    results: "Result",
    bytes: "Bytes",
    megabytes: "Megabytes",
    mebibytes: "Mebibytes",
    gigabytes: "Gigabytes",
    gibibytes: "Gibibytes",
    filesThatFit: "How many such files fit",
    modelNote:
      "This is the size of the pixel data alone, without container headers, thumbnails or any compression — it is not a prediction of a RAW or JPEG file's size.",

    inputs: "Entered",
    formula: "bytesPerRow = ⌈width·channels·depth/8⌉     bytes = bytesPerRow·height·layers",

    errorWidth: "The width must be a whole number between 1 and 1000000 px.",
    errorHeight: "The height must be a whole number between 1 and 1000000 px.",
    errorChannels: "The number of channels must be a whole number between 1 and 16.",
    errorBitDepth: "The bit depth must be 1, 8, 16 or 32.",
    errorLayers: "The number of layers must be a whole number between 1 and 10000.",
    errorCapacity: "The available space must be greater than zero.",
    errorAverageFileSizeMb: "The average file size must be greater than zero.",

    unitMb: "MB",
    unitMib: "MiB",
    unitGb: "GB",
    unitGib: "GiB",
  },

  "smpte-timecode": {
    rate: "Frame rate",
    rate23976: "23.976",
    rate24: "24",
    rate25: "25",
    rate2997Ndf: "29.97 (no drop)",
    rate2997Df: "29.97 (drop frame)",
    rate30: "30",
    rate50: "50",
    rate5994Ndf: "59.94 (no drop)",
    rate5994Df: "59.94 (drop frame)",
    rate60: "60",
    operation: "Action",
    operationAdd: "Addition",
    operationSubtract: "Subtraction",

    timecodeA: "Timecode A",
    timecodeB: "Timecode B or frame count",
    timecodeBHint:
      "Optional. If timecode B is filled, it is used; otherwise the frame count below. When neither is entered, only the conversion of timecode A is shown.",
    hours: "Hours",
    minutes: "Minutes",
    seconds: "Seconds",
    frames: "Frames",
    frameCountB: "Frame count (instead of timecode B)",

    results: "Result",
    timecodeHours: "Hours (label)",
    timecodeMinutes: "Minutes (label)",
    timecodeSeconds: "Seconds (label)",
    timecodeFrames: "Frames (label)",
    elapsedSeconds: "Actual elapsed time",
    realSeconds: "Actual elapsed time",
    nominalSeconds: "Nominal time (reading the label)",
    driftSeconds: "Deviation of the label from actual time",
    wrapNote:
      "The label is shown on a 24-hour counter (24:00:00;00 becomes 00:00:00;00) — the frame count in the “Frames” field above is the true, unwrapped total.",

    inputs: "Entered",
    formula:
      "frames = ((H·60+M)·60+S)·N + F     drop-frame subtracts D·(minutes − ⌊minutes/10⌋) by ST 12-1",

    errorHours: "The hours must be a whole number between 0 and 23.",
    errorMinutes: "The minutes must be a whole number between 0 and 59.",
    errorSeconds: "The seconds must be a whole number between 0 and 59.",
    errorFrames: "The frames must be a whole number below the nominal rate.",
    errorDroppedLabel: "This label does not exist in drop-frame notation at the chosen rate.",
    errorOperand: "Enter timecode B or a frame count, not both at once as two separate conditions.",
    errorOperandFrames: "The frame count must be a whole number within one 24-hour cycle.",

    unitS: "s",
  },

  "timelapse-planner": {
    interval: "Interval between frames",
    fps: "Timeline frame rate",
    clipLength: "Clip length",
    targetHint: "Leave exactly one of clip length, recording duration or frame count empty.",
    shootingDuration: "Recording duration",
    frameCount: "Frame count",
    shutter: "Shutter time per frame",
    shutterHint: "Optional — only compared with the interval, with no recommendation.",

    results: "Result",
    speedUpFactor: "Speed-up factor",
    shutterOverIntervalRatio: "Shutter ÷ interval",
    fencepostNote: "N frames at the interval covers (N − 1) intervals, not N.",

    inputs: "Entered",
    formula: "Nf = round(L·fps)     T = (Nf − 1)·i     L = Nf/fps     speed-up = i·fps",

    errorInterval: "The interval must be between 0.05 and 86400 s.",
    errorClipLength: "The clip length must be between 0.04 and 86400 s.",
    errorShootingDuration: "The recording duration must be between 1 and 8640000 s.",
    errorFrameCount: "The frame count must be a whole number between 1 and 1000000.",
    errorShutter: "The shutter time must be between 1 μs and 3600 s.",
    errorTarget: "Enter exactly one of clip length, recording duration or frame count.",

    unitS: "s",
  },

  "video-bitrate-storage": {
    videoBitrateMbps: "Video bitrate",
    audioBitrateMbps: "Audio bitrate",
    duration: "Duration",
    targetHint: "Leave exactly one of duration, file size or capacity empty.",
    sizeValue: "File size",
    sizeUnit: "Size unit",
    capacityGb: "Card or disk capacity (GB, as on the label)",
    cardCount: "Number of cards or copies",

    results: "Result",
    totalBitrateMbps: "Total bitrate",
    gigabytes: "Gigabytes",
    gibibytes: "Gibibytes",
    recordableSecondsPerCard: "Recording time per card",
    recordableSecondsTotal: "Total recording time (all cards)",
    modelNote:
      "Plain bitrate arithmetic — it does not include container headers or variable bitrate. Both ways of counting bytes (GB and GiB) are shown side by side.",

    inputs: "Entered",
    formula:
      "total = video + audio     bytes = total·duration/8     duration = bytes·8/total",

    errorVideoBitrateMbps: "The video bitrate must be between 0.01 and 20000 Mbit/s.",
    errorAudioBitrateMbps: "The audio bitrate must be between 0 and 100 Mbit/s.",
    errorCardCount: "The number of cards must be a whole number between 1 and 1000.",
    errorDuration: "The duration must be between 0.04 and 864000 s.",
    errorSize: "The file size must be greater than zero.",
    errorCapacityGb: "The capacity must be between 0.001 and 1000000 GB.",
    errorTarget: "Enter exactly one of duration, file size or capacity.",

    unitS: "s",
    unitMbps: "Mbit/s",
    unitGb: "GB",
    unitGib: "GiB",
  },
} as const;
