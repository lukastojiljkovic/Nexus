import { sr } from "./copy.sr.js";

/**
 * SIGNALS in English — the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error
 * each. The register is the app's own English: sentence case, informative, no
 * exclamation marks.
 */
export const en: typeof sr = {
  page: {
    subtitle:
      "Morse, an ASCII table, a tuner and a sound meter: the microphone opens only when one is started.",
  },
  tabs: {
    morse: "Morse",
    ascii: "ASCII",
    tuner: "Tuner",
    meter: "Sound meter",
  },
  common: {
    start: "Start",
    stop: "Stop",
    listening: "Listening",
    micDenied:
      "The microphone is not available. Check the microphone permission in Windows settings.",
    micFailed: "The microphone did not open.",
    deviceNote: "Audio is processed in the background; the page stays responsive.",
    mainThreadNote: "Analysis is running on the main thread because this window refuses a worker.",
  },
  morse: {
    title: "Text and code",
    textLabel: "Text",
    codeLabel: "Morse code",
    toCode: "To Morse",
    toText: "To text",
    // One leaf for both cases: a character sent as another one (č as c) and a
    // character with no code at all (€) both arrive in the engine's one list.
    transliterated: "Not sent as written:",
    unknownTokens: "Unknown token in the code:",
    wordsHint: "Words are separated by three spaces or a slash, letters by one space.",
    playback: "Tone and speed",
    speedLabel: "Character speed (words per minute)",
    messageSpeedLabel: "Message speed (Farnsworth)",
    messageSpeedHint: "Slower than the character speed, it stretches the gaps only.",
    pitchLabel: "Tone pitch (Hz)",
    play: "Play the tone",
    stop: "Stop the tone",
    durationLabel: "Duration",
    silence: "There is nothing to play.",
    lamp: "Screen lamp",
    lampWarningTitle: "Warning before flashing",
    lampWarningBody:
      "Flashing light can trigger a seizure in people with photosensitive epilepsy. If that is a risk for you or for somebody in the room, do not start it. The screen will alternate white and black at the speed you set.",
    lampStart: "Start flashing",
    lampStop: "Stop flashing",
    lampKeyHint: "Escape stops the flashing.",
    lampStopped: "The flashing has stopped.",
    decode: "Decoding from the microphone",
    decodeHint: "Key by hand or play a recording. The speed is measured from what was heard.",
    heard: "Heard",
    unit: "Unit",
    wpm: "Speed",
    confidence: "Confidence",
    confidenceHint: "The share of the marks heard that were exactly a dot or a dash long.",
    guessed: "This is an estimate, not a measurement: nothing in it measured one unit.",
    nothingHeard: "Nothing has been received yet.",
    alphabetTitle: "Alphabet",
    alphabetHint: "ITU-R M.1677-1, Annex 1.",
  },
  ascii: {
    searchLabel: "Search",
    searchPlaceholder: "e.g. 65, 4A, TAB, A",
    radixLabel: "Base",
    radixNames: {
      "2": "Binary (2)",
      "8": "Octal (8)",
      "10": "Decimal (10)",
      "16": "Hexadecimal (16)",
    },
    sortLabel: "Order",
    sortByCode: "By code",
    sortByName: "By name",
    columns: {
      decimal: "Decimal",
      hex: "Hex",
      binary: "Binary",
      char: "Char",
      name: "Name",
    },
    tableTitle: "The ASCII table",
    tableHint: "Showing {shown} of 128 codes.",
    emptyRow: "No code matches the search.",
    textLabel: "Text",
    codesLabel: "Codes",
    toCodes: "To codes",
    toText: "To text",
    refused: "Not ASCII:",
    codesRefused: "Cannot be read:",
    controlHint: "Control codes are shown by name, never as a character.",
  },
  tuner: {
    presetLabel: "Instrument",
    strings: "Strings",
    start: "Start the tuner",
    stop: "Stop the tuner",
    noteLabel: "Note",
    centsLabel: "Deviation in cents",
    frequencyLabel: "Frequency",
    targetLabel: "Target",
    inTune: "In tune",
    waiting: "Waiting for a tone",
    gated: "Too quiet to measure: bring the instrument closer to the microphone.",
    clarityLabel: "Periodicity",
    a4Label: "Reference A4 (Hz)",
    a4Hint: "415 to 466 Hz, the range of historical and modern pitch.",
    presetNames: {
      guitar: "Guitar (standard)",
      bass: "Bass",
      violin: "Violin",
      ukulele: "Ukulele (G4)",
      ukuleleLowG: "Ukulele (low G)",
      chromatic: "Chromatic scale (C2 to C6)",
    },
  },
  meter: {
    title: "Sound level",
    start: "Start measuring",
    stop: "Stop measuring",
    rmsLabel: "Level (RMS)",
    peakLabel: "Peak",
    dbfs: "dBFS",
    db: "dB",
    crestLabel: "Peak-to-level ratio",
    crestHint: "A ratio, not a level.",
    leqLabel: "Equivalent level (Leq)",
    resetPeak: "Reset the peak",
    notCalibrated:
      "This is not a calibrated level in dB SPL. A laptop microphone carries no calibration, so every figure is in dBFS, decibels relative to full scale, and cannot be read as an absolute loudness.",
    historyTitle: "Level history",
    historyDescription:
      "The level in dBFS per second since the measurement began, at most {count} seconds back.",
    historyEmpty: "No measured second yet.",
    historyCaption: "A {count}-second window; the line is the level, the hairline the held peak.",
    peakRule: "held peak",
  },
  settings: {
    speedCaption:
      "These values belong to this machine and do not travel in the profile's archive.",
    speedHint: "Characters are sent at this speed; the message may go slower.",
    pitchHint: "A sine tone from 300 to 1200 Hz.",
    a4Hint: "415 to 466 Hz. The same value the tuner on the page uses.",
    invalid: "The value is outside the allowed range.",
    reset: "Restore the defaults",
  },
};
