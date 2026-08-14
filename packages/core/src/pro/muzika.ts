/**
 * „Muzika i produkcija" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains:
 * a tool several packs share lives in the file of its FIRST pack in `TOOL_PACKS`
 * order, so nobody has to relitigate ownership per tool. What a maintainer asks
 * is „where does the delay-time table live", and `pro/muzika.ts` answers it.
 *
 * **These are pure functions and they refuse rather than repair.** No dates, no
 * randomness, no locale, no I/O. A surface owns its own state, formats nothing
 * on its own, and asks here for every number it prints — which is why the test
 * vectors are ones a person can check by hand rather than snapshots.
 *
 * **Four things are written once here because four tools each needed them.**
 * `c(T)` (reverb, room modes, wavelength), the mm:ss.mmm formatter (bars, PCM,
 * varispeed), the letter/accidental speller (scales, chords, transposition) and
 * `mod12`. Copied per tool they would be four chances to disagree about the same
 * physics — the four-copies-of-the-arithmetic defect at its smallest scale.
 *
 * **Two tools in this pack are `life-safety` and neither returns a verdict.**
 * `speakerLoad` can cook an amplifier and `splAtDistance` can damage hearing, so
 * both compute a QUANTITY and stop: where a rule has a limit, the limit is an
 * INPUT with no default, and what comes back is the pair of numbers and their
 * ratio. No boolean, no status, no severity, no word about what the pair means —
 * the minimum load is the manufacturer's number and the sound-level limit is
 * whatever rule the user is working to, and this app has seen neither.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isKeyOf,
  isNonNegative,
  isOneOf,
  isPositive,
  ratioAgainst,
  type ProResult,
} from "./result.js";

// --- Shared constants and helpers -------------------------------------------

/** Speed of sound in dry air at 0 °C, m/s. */
const SPEED_OF_SOUND_0C = 331.3;

/** Celsius-to-Kelvin offset, exact by the SI definition of the kelvin. */
const KELVIN_OFFSET = 273.15;

/**
 * 24 * ln(10) = 55.26204223185719 — the 60 dB decay of RT60 written out.
 *
 * The familiar 0.161 is only this divided by c = 343.2, and hard-coding it would
 * silently throw away the temperature the user typed.
 */
const RT60_FACTOR = 24 * Math.LN10;

/** 0 dBu is the voltage that dissipates exactly 1 mW into 600 ohm: sqrt(0.001*600). */
const DBU_REFERENCE_V = Math.sqrt(0.6);

/** The cent is DEFINED as one twelve-hundredth of an octave (Ellis). */
const CENTS_PER_OCTAVE = 1200;

/** Letter names in pitch order; `charAt` never yields undefined, unlike `[i]`. */
const LETTERS = "CDEFGAB";

/** Pitch class of each natural, by letter index — C 0, D 2, E 4, F 5, G 7, A 9, B 11. */
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11] as const;

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Euclidean remainder — JS `%` keeps the sign of the dividend, which pitch maths cannot use. */
function mod(value: number, base: number): number {
  return ((value % base) + base) % base;
}

const mod12 = (value: number): number => mod(value, 12);

/** Natural pitch class of a letter index; the mod makes the fallback unreachable. */
function naturalPc(letterIndex: number): number {
  return NATURAL_PC[mod(letterIndex, 7)] ?? 0;
}

/** Name of a pitch class; the mod makes the fallback unreachable. */
function pitchClassName(pitchClass: number, flat: boolean): string {
  const table = flat ? FLAT_NAMES : SHARP_NAMES;
  return table[mod12(pitchClass)] ?? "";
}

/** `##` rather than `x`, because that is the form the surface must be able to read back. */
function accidentalSymbol(accidental: number): string {
  if (accidental === 0) return "";
  return accidental > 0 ? "#".repeat(accidental) : "b".repeat(-accidental);
}

function accidentalValue(token: string | undefined): number {
  if (token === undefined || token === "") return 0;
  if (token === "x") return 2;
  return token.startsWith("#") ? token.length : -token.length;
}

interface LetterAccidental {
  readonly letterIndex: number;
  readonly accidental: number;
}

/** Parses `C`, `F#`, `Bbb`, `Fx` — the letter alone, with no octave. */
function parseLetterAccidental(text: string): LetterAccidental | undefined {
  const match = /^([A-Ga-g])(#{1,2}|b{1,2}|x)?$/.exec(text);
  if (match === null) return undefined;
  const letterIndex = LETTERS.indexOf((match[1] ?? "").toUpperCase());
  if (letterIndex < 0) return undefined;
  return { letterIndex, accidental: accidentalValue(match[2]) };
}

/**
 * The accidental a letter needs to reach a pitch class, in -6..+5.
 *
 * The `+6 … -6` form is what makes pitch class 11 spell as Cb against natural C
 * (-1, not +11) and pitch class 0 spell as B# against natural B (+1, not -11),
 * with no special case for the octave crossing.
 */
function accidentalFor(letterIndex: number, pitchClass: number): number {
  return mod12(pitchClass - naturalPc(letterIndex) + 6) - 6;
}

/** A degree of a scale, a chord, or one transposed note. */
export interface SpelledNote {
  /** Letter plus accidental, e.g. `Gb`; undefined when it needs a triple accidental. */
  readonly name: string | undefined;
  readonly letter: string;
  /** The accidental the spelling requires, in -6..+5, kept even when unspellable. */
  readonly accidental: number;
  readonly pitchClass: number;
  /** Semitones above the root as the pattern writes them — 14 for a ninth, not 2. */
  readonly semitones: number;
}

/**
 * Spells one note from the letter it must be written on and its pitch class.
 *
 * A degree needing more than a double accidental is reported as unspellable
 * (`name: undefined`) and is deliberately NOT renamed enharmonically: G## major
 * genuinely has no seventh degree that Western notation can write, and printing
 * `F###` as `G` would be this tool changing the key the user asked for.
 */
function spellNote(letterIndex: number, pitchClass: number, semitones: number): SpelledNote {
  const accidental = accidentalFor(letterIndex, pitchClass);
  const letter = LETTERS.charAt(mod(letterIndex, 7));
  return {
    name: Math.abs(accidental) <= 2 ? `${letter}${accidentalSymbol(accidental)}` : undefined,
    letter,
    accidental,
    pitchClass,
    semitones,
  };
}

/**
 * Speed of sound in dry air, m/s, from the ideal-gas result written about 0 °C.
 *
 * Dry air on purpose: humidity moves c by well under 1 %, and an invented
 * humidity correction would look like added precision and be none.
 */
function speedOfSound(celsius: number): number {
  return SPEED_OF_SOUND_0C * Math.sqrt(1 + celsius / KELVIN_OFFSET);
}

const pad = (value: number, width: number): string => value.toString().padStart(width, "0");

/**
 * `mm:ss.mmm`, or `HH:MM:SS.mmm` once the value passes an hour.
 *
 * The milliseconds field is TRUNCATED, never rounded: 54.8571 s must not render
 * as a string that reads longer than the seconds figure printed beside it, and
 * 59.9996 s must not render as `01:00.000` while the number next to it says 59.
 */
function formatDuration(seconds: number): string {
  const totalMs = Math.floor(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = (totalMs - ms) / 1000;
  const secs = totalSeconds % 60;
  const totalMinutes = (totalSeconds - secs) / 60;
  const minutes = totalMinutes % 60;
  const hours = (totalMinutes - minutes) / 60;
  const tail = `${pad(minutes, 2)}:${pad(secs, 2)}.${pad(ms, 3)}`;
  return hours > 0 ? `${pad(hours, 2)}:${tail}` : tail;
}

/** JS `Math.round` sends -2.5 to -2; a MIDI number exactly on .5 must go away from zero. */
function roundHalfAwayFromZero(value: number): number {
  const rounded = Math.round(Math.abs(value));
  return value < 0 ? -rounded || 0 : rounded;
}

// `isKeyOf` and `isOneOf` were written here first and now live in the kit: this
// file's own tables — SCALE_PATTERNS, CHORD_PATTERNS, INTERVALS,
// INSTRUMENT_TRANSPOSITION — and its `===` selectors (quantity, bpmReference,
// octaveConvention, sensitivityReference, mode, enharmonicPreference, a
// TransposeBy's direction) are indexed and compared with values that crossed the
// renderer boundary, which is the general case and not a music one.

// --- Levels, decibels and voltage -------------------------------------------

/** Which field the user typed. Exactly one, so the pane can never contradict itself. */
export type AudioLevelEntry =
  | { readonly kind: "dbu"; readonly value: number }
  | { readonly kind: "dbv"; readonly value: number }
  | { readonly kind: "vrms"; readonly value: number }
  | { readonly kind: "vpp"; readonly value: number }
  | { readonly kind: "dbm"; readonly value: number }
  | { readonly kind: "dbfs"; readonly value: number };

/**
 * The one fact a dBFS reading needs and nothing else supplies: where 0 dBFS sits
 * on the analogue scale. Stated either way round, because both are real house
 * conventions and nobody agrees which: EBU R68 puts +4 dBu at −18 dBFS, SMPTE
 * RP 155 puts it at −20 dBFS. Typing either one pins the same single number —
 * the dBu that corresponds to 0 dBFS — and NEITHER form is a default.
 */
export type AudioLevelCalibration =
  | { readonly kind: "dbu-at-0-dbfs"; readonly value: number }
  | { readonly kind: "dbfs-at-plus4-dbu"; readonly value: number };

export interface AudioLevelInput {
  readonly entry: AudioLevelEntry;
  /**
   * Reference impedance in ohm — 600 for a classic line, 50 for RF.
   *
   * No default, because assuming 600 is exactly what makes dBu and dBm look
   * interchangeable when they are not: they coincide at 600 ohm and nowhere
   * else. Without it the dBm figure is simply absent; the `dbm` entry needs it.
   */
  readonly impedance?: number | undefined;
  /**
   * Where the digital scale is anchored to the analogue one. Required by the
   * `dbfs` entry point; without it a dBFS reading has no dBu equivalent at all —
   * see `AudioLevelCalibration`. When given, it also feeds the `dbfs` OUTPUT
   * field for every other entry point, which is the everyday question this tool
   * exists to answer.
   */
  readonly calibration?: AudioLevelCalibration | undefined;
}

export interface AudioLevel {
  readonly dbu: number;
  readonly dbv: number;
  readonly vrms: number;
  /** Sine only — for programme material the crest factor is a property of the signal. */
  readonly vpeak: number;
  /** Sine only, 2 × peak. */
  readonly vpp: number;
  /** undefined until an impedance is supplied; dBm without one means nothing. */
  readonly dbm: number | undefined;
  /** Echoed so the surface can print which impedance the dBm figure was taken at. */
  readonly impedance: number | undefined;
  /** undefined without a `calibration`; dBFS without one means nothing either. */
  readonly dbfs: number | undefined;
}

/** The single dBu-at-0-dBFS figure a calibration statement pins, in either form. */
function calibrationOffset(calibration: AudioLevelCalibration): number {
  // +4 dBu at X dBFS means 0 dBFS is (4 - X) dB above +4 dBu, i.e. at 4 - X dBu.
  return calibration.kind === "dbu-at-0-dbfs" ? calibration.value : 4 - calibration.value;
}

function levelEntryToVrms(
  entry: AudioLevelEntry,
  impedance: number | undefined,
  dbuAt0Dbfs: number | undefined,
): ProResult<{ readonly vrms: number }> {
  switch (entry.kind) {
    case "dbu":
      if (!isInRange(entry.value, -100, 60)) return fail("dbu");
      return { ok: true, vrms: DBU_REFERENCE_V * 10 ** (entry.value / 20) };
    case "dbv":
      if (!isInRange(entry.value, -100, 60)) return fail("dbv");
      return { ok: true, vrms: 10 ** (entry.value / 20) };
    case "vrms":
      if (!isPositive(entry.value)) return fail("vrms");
      return { ok: true, vrms: entry.value };
    case "vpp":
      if (!isPositive(entry.value)) return fail("vpp");
      return { ok: true, vrms: entry.value / (2 * Math.SQRT2) };
    case "dbm":
      if (!isInRange(entry.value, -100, 60)) return fail("dbm");
      if (impedance === undefined) return fail("impedance");
      return { ok: true, vrms: Math.sqrt(0.001 * impedance * 10 ** (entry.value / 10)) };
    case "dbfs": {
      if (!Number.isFinite(entry.value)) return fail("dbfs");
      if (dbuAt0Dbfs === undefined) return fail("calibration");
      const dbu = entry.value + dbuAt0Dbfs;
      if (!isInRange(dbu, -100, 60)) return fail("dbfs");
      return { ok: true, vrms: DBU_REFERENCE_V * 10 ** (dbu / 20) };
    }
  }
}

/**
 * One line level expressed in every unit the same signal has.
 *
 * **dBu and dBm are not the same scale.** They agree numerically at 600 ohm and
 * only there, which is why the impedance is never assumed: 0 dBm is 0.7746 V
 * into 600 ohm and 0.2236 V into 50 ohm, and a tool that defaults the impedance
 * hands the user the wrong voltage without ever mentioning the assumption.
 *
 * **dBFS is the same story a second time.** It has no meaning at all until the
 * user states which dBu their converter calls 0 dBFS, and the two house
 * conventions (EBU +4 dBu = −18 dBFS, SMPTE film −20 dBFS) differ by 2 dB —
 * defaulting to either would be this tool asserting a studio's alignment level.
 */
export function audioLevel(input: AudioLevelInput): ProResult<AudioLevel> {
  const { impedance, calibration } = input;
  if (impedance !== undefined && !isPositive(impedance)) return fail("impedance");
  // `calibrationOffset` is always a dBu figure, in either calibration form —
  // it is where 0 dBFS sits on the analogue scale. For every entry point OTHER
  // than `dbfs` this value never touches `levelEntryToVrms`; it only feeds the
  // `dbfs` OUTPUT field below (`dbu - dbuAt0Dbfs`), so an unvalidated NaN or a
  // wild figure such as 1e9 would sail straight through as an answer with
  // `ok: true` instead of being refused, unlike every other numeric input here.
  let dbuAt0Dbfs: number | undefined;
  if (calibration !== undefined) {
    dbuAt0Dbfs = calibrationOffset(calibration);
    if (!isInRange(dbuAt0Dbfs, -100, 60)) return fail("calibration");
  }
  const source = levelEntryToVrms(input.entry, impedance, dbuAt0Dbfs);
  if (!source.ok) return source;

  const { vrms } = source;
  const vpeak = vrms * Math.SQRT2;
  const dbu = 20 * Math.log10(vrms / DBU_REFERENCE_V);
  return {
    ok: true,
    dbu,
    dbv: 20 * Math.log10(vrms),
    vrms,
    vpeak,
    vpp: 2 * vpeak,
    dbm: impedance === undefined ? undefined : 10 * Math.log10((vrms * vrms) / impedance / 0.001),
    impedance,
    dbfs: dbuAt0Dbfs === undefined ? undefined : dbu - dbuAt0Dbfs,
  };
}

/**
 * Whether the ratio is of a root-power (amplitude, voltage, pressure) quantity or
 * of a power quantity — the factor 20 is only the factor 10 applied to a square.
 */
export type DecibelQuantity = "amplitude" | "power";

export type DecibelEntry =
  | { readonly kind: "decibels"; readonly value: number }
  | { readonly kind: "ratio"; readonly value: number };

export interface DecibelRatioInput {
  readonly entry: DecibelEntry;
  /** Default `amplitude`; a selector between two unit definitions, not a measurement. */
  readonly quantity?: DecibelQuantity | undefined;
}

export interface DecibelRatioResult {
  readonly decibels: number;
  readonly ratio: number;
  /** The same ratio as a percentage — 0.501187 is 50.1187 %. */
  readonly percent: number;
  readonly quantity: DecibelQuantity;
}

/**
 * A decibel figure and its linear ratio, in whichever direction was typed.
 *
 * A ratio of zero or less has no decibel value at all and is refused rather than
 * shown as -Infinity: silence is not „-∞ dB", it is the absence of a ratio.
 */
export function decibelRatio(input: DecibelRatioInput): ProResult<DecibelRatioResult> {
  const quantity = input.quantity ?? "amplitude";
  if (!isOneOf(quantity, ["amplitude", "power"] as const)) return fail("quantity");
  const factor = quantity === "power" ? 10 : 20;
  const { entry } = input;
  if (entry.kind === "decibels") {
    if (!isInRange(entry.value, -200, 200)) return fail("decibels");
    const ratio = 10 ** (entry.value / factor);
    return { ok: true, decibels: entry.value, ratio, percent: ratio * 100, quantity };
  }
  if (!isPositive(entry.value)) return fail("ratio");
  const decibels = factor * Math.log10(entry.value);
  return { ok: true, decibels, ratio: entry.value, percent: entry.value * 100, quantity };
}

export interface DecibelSumInput {
  /** Levels in dB, 1..64 of them. */
  readonly levels: readonly number[];
}

export interface DecibelShare {
  readonly level: number;
  /** Share of the total ENERGY, in percent; the shares total 100 by construction. */
  readonly percent: number;
}

export interface DecibelSumResult {
  readonly sum: number;
  readonly shares: readonly DecibelShare[];
}

/**
 * The INCOHERENT sum of several levels — a power sum, whatever the sources are.
 *
 * Incoherent means uncorrelated: two equal sources add 3.0103 dB, not 6.0206.
 * Coherent sources add by amplitude and that is a different question, which the
 * surface says in words rather than letting the reader assume this covers it.
 */
export function decibelSum(input: DecibelSumInput): ProResult<DecibelSumResult> {
  const { levels } = input;
  if (levels.length < 1 || levels.length > 64) return fail("levels");
  let total = 0;
  const powers: number[] = [];
  for (const level of levels) {
    if (!isInRange(level, -200, 200)) return fail("levels");
    const power = 10 ** (level / 10);
    powers.push(power);
    total += power;
  }
  if (!isPositive(total)) return fail("levels");
  return {
    ok: true,
    sum: 10 * Math.log10(total),
    shares: levels.map((level, index) => ({
      level,
      percent: ((powers[index] ?? 0) / total) * 100,
    })),
  };
}

export interface CompressorInput {
  /** dBFS, -80..0. */
  readonly threshold: number;
  /** n:1, 1..1000. A ratio of 1 is no compression at all. */
  readonly ratio: number;
  /** Knee width in dB, 0..40. Default 0 — a hard knee. */
  readonly knee?: number | undefined;
  /** dBFS, -120..+20. */
  readonly inputLevel: number;
  /** dB, -20..+40. Default 0. */
  readonly makeup?: number | undefined;
  /**
   * The programme level the makeup gain should restore, in dBFS, -120..+20.
   *
   * NOT defaulted to 0 dBFS. Mastering returns the curve to a working level, not
   * to full scale, and the earlier version of this tool hard-coded 0 dBFS as if
   * „restore to full scale" were the only question anyone asks — a silent
   * assumption is exactly what the reference has to stop being. Absent,
   * `makeupToReference` is not reported at all.
   */
  readonly makeupReferenceLevel?: number | undefined;
}

export interface CompressorPoint {
  readonly outputLevel: number;
  /** Input minus output, in dB. Positive when the curve pulls the level down. */
  readonly gainReduction: number;
  readonly outputWithMakeup: number;
  /**
   * The makeup that puts `makeupReferenceLevel` back at itself through this same
   * curve — undefined without a stated reference level.
   */
  readonly makeupToReference: number | undefined;
}

/**
 * The standard soft-knee transfer function, evaluated at one input level.
 *
 * The knee branch is QUADRATIC, which is what makes the curve continuous and
 * gives it a continuous first derivative at both knee edges; an implementation
 * that interpolates linearly across the knee agrees at the edges and nowhere in
 * between. `W = 0` must be special-cased ahead of it, or the knee branch divides
 * by `2*W` exactly when the input sits on the threshold.
 */
function compressorOutput(x: number, threshold: number, ratio: number, knee: number): number {
  const over = 2 * (x - threshold);
  if (knee <= 0) return x <= threshold ? x : threshold + (x - threshold) / ratio;
  if (over < -knee) return x;
  if (over <= knee) return x + (1 / ratio - 1) * (x - threshold + knee / 2) ** 2 / (2 * knee);
  return threshold + (x - threshold) / ratio;
}

/**
 * What a compressor does to one input level, given its threshold, ratio and knee.
 *
 * The knee reaches BELOW the threshold as well as above it: at exactly the
 * threshold with a 6 dB knee the curve is already 0.5625 dB down, where a hard
 * knee would still be at unity. That difference is the whole point of a knee,
 * and a reader who expects gain reduction to start at the threshold will read
 * the number as a bug.
 */
export function compressorCurve(input: CompressorInput): ProResult<CompressorPoint> {
  const { threshold, ratio, inputLevel } = input;
  const knee = input.knee ?? 0;
  const makeup = input.makeup ?? 0;
  if (!isInRange(threshold, -80, 0)) return fail("threshold");
  if (!isInRange(ratio, 1, 1000)) return fail("ratio");
  if (!isInRange(knee, 0, 40)) return fail("knee");
  if (!isInRange(inputLevel, -120, 20)) return fail("inputLevel");
  if (!isInRange(makeup, -20, 40)) return fail("makeup");
  const { makeupReferenceLevel } = input;
  if (makeupReferenceLevel !== undefined && !isInRange(makeupReferenceLevel, -120, 20)) {
    return fail("makeupReferenceLevel");
  }

  const outputLevel = compressorOutput(inputLevel, threshold, ratio, knee);
  return {
    ok: true,
    outputLevel,
    gainReduction: inputLevel - outputLevel,
    outputWithMakeup: outputLevel + makeup,
    makeupToReference:
      makeupReferenceLevel === undefined
        ? undefined
        : makeupReferenceLevel - compressorOutput(makeupReferenceLevel, threshold, ratio, knee),
  };
}

// --- Pitch, tuning and intervals --------------------------------------------

/** ISO 16:1975 gives 440 Hz as the standard, and 415 and 442 are real working values. */
const DEFAULT_REFERENCE_PITCH = 440;

/** MIDI 1.0 Detailed Specification 4.2 (MMA, 1996): note 69 is A4, note 60 is C4. */
const MIDI_A4 = 69;

/**
 * Which note MIDI 60 is called. `scientific` (default) is what the MIDI
 * specification's own note table prints (60 = C4); `yamaha` is the other
 * convention that is common on hardware and calls the same note C3. The two
 * disagree on every octave number, never on a MIDI number or a frequency, so
 * this is purely a labelling choice — and one this tool states rather than
 * assumes, since assuming the wrong one is a silent off-by-one octave.
 */
export type OctaveConvention = "scientific" | "yamaha";

/** Octave = floor(midi/12) − this. Scientific: MIDI 60 = C4. Yamaha: MIDI 60 = C3. */
function octaveOffset(convention: OctaveConvention): number {
  return convention === "yamaha" ? 2 : 1;
}

/**
 * The stated convention, defaulted and validated in one place. `undefined`
 * for anything but the two named ones — the renderer is untrusted (SEC-EL),
 * and `convention === "yamaha" ? 2 : 1` above would otherwise fold every
 * unrecognised value into "scientific" silently rather than refusing.
 */
function octaveConventionOf(value: OctaveConvention | undefined): OctaveConvention | undefined {
  const convention = value ?? "scientific";
  return isOneOf(convention, ["scientific", "yamaha"] as const) ? convention : undefined;
}

interface PitchOptions {
  readonly referencePitch?: number | undefined;
  readonly octaveConvention?: OctaveConvention | undefined;
  /**
   * A second frequency, Hz — absorbs the retired standalone cents/ratio tool.
   * When given, the result reports the interval FROM the computed pitch TO this
   * frequency (cents, semitones, ratio, beat Hz).
   */
  readonly secondFrequency?: number | undefined;
  /**
   * A signed cents offset, -12000..+12000 — absorbs the retired tool's other
   * half. When given, the result also reports the pitch that this pitch's
   * frequency lands on after being shifted by it.
   */
  readonly pitchShiftCents?: number | undefined;
}

export interface MidiPitchInput extends PitchOptions {
  /** MIDI note number, 0..127. */
  readonly midi: number;
}

export interface NamedPitchInput extends PitchOptions {
  /** Scientific pitch notation: `A4`, `C#3`, `Bb-1`, `Fx2` — read under `octaveConvention`. */
  readonly name: string;
}

export interface FrequencyPitchInput extends PitchOptions {
  readonly frequency: number;
}

export interface Pitch {
  readonly midi: number;
  readonly frequency: number;
  /** Sharp spelling with octave, e.g. `C#4`. */
  readonly name: string;
  /** Flat enharmonic, e.g. `Db4`; identical to `name` for a natural. */
  readonly flatName: string;
  readonly pitchClass: number;
  readonly octave: number;
  /** True when the number falls outside 0..127 — reported as it is, never clamped. */
  readonly outsideMidiRange: boolean;
  /** Which octave numbering `octave` (and the two names) were written under. */
  readonly octaveConvention: OctaveConvention;
  /** The interval to `secondFrequency`, when it was given. */
  readonly intervalToSecond: CentsRatioResult | undefined;
  /** This pitch's frequency shifted by `pitchShiftCents` and spelled again, when it was given. */
  readonly shifted: NearestPitch | undefined;
}

export interface NearestPitch extends Pitch {
  /** The real-valued MIDI number the frequency lands on, before rounding. */
  readonly midiExact: number;
  /** Signed deviation from the nearest note, in cents; always within [-50, +50]. */
  readonly cents: number;
}

function frequencyOfMidi(midi: number, reference: number): number {
  return reference * 2 ** ((midi - MIDI_A4) / 12);
}

interface BarePitch {
  readonly midi: number;
  readonly frequency: number;
  readonly name: string;
  readonly flatName: string;
  readonly pitchClass: number;
  readonly octave: number;
  readonly outsideMidiRange: boolean;
  readonly octaveConvention: OctaveConvention;
}

function describeMidi(midi: number, reference: number, convention: OctaveConvention): BarePitch {
  const pitchClass = mod12(midi);
  const octave = Math.floor(midi / 12) - octaveOffset(convention);
  return {
    midi,
    frequency: frequencyOfMidi(midi, reference),
    name: `${pitchClassName(pitchClass, false)}${octave}`,
    flatName: `${pitchClassName(pitchClass, true)}${octave}`,
    pitchClass,
    octave,
    outsideMidiRange: midi < 0 || midi > 127,
    octaveConvention: convention,
  };
}

function nearestPitchOf(frequency: number, reference: number, convention: OctaveConvention) {
  const midiExact = MIDI_A4 + 12 * Math.log2(frequency / reference);
  const nearest = roundHalfAwayFromZero(midiExact);
  return {
    ...describeMidi(nearest, reference, convention),
    midiExact,
    cents: (midiExact - nearest) * 100,
  };
}

function referenceOf(value: number | undefined): number | undefined {
  const reference = value ?? DEFAULT_REFERENCE_PITCH;
  return isInRange(reference, 380, 500) ? reference : undefined;
}

interface PitchExtraFields {
  readonly intervalToSecond: CentsRatioResult | undefined;
  readonly shifted: NearestPitch | undefined;
}

/**
 * The two optional add-ons every pitch entry point shares — the interval to a
 * second frequency, and this pitch shifted by a cents offset.
 *
 * `frequency` is already positive by construction (every caller validates its
 * own frequency, real or computed, before reaching here), so the only new
 * validation is of the two optional fields themselves.
 */
function pitchExtras(
  frequency: number,
  reference: number,
  convention: OctaveConvention,
  extras: PitchOptions,
): ProResult<PitchExtraFields> {
  let intervalToSecond: CentsRatioResult | undefined;
  if (extras.secondFrequency !== undefined) {
    if (!isPositive(extras.secondFrequency)) return fail("secondFrequency");
    const interval = centsRatio({
      entry: { kind: "frequencies", a: frequency, b: extras.secondFrequency },
    });
    if (!interval.ok) return interval;
    // `interval` is a `ProResult` and carries `ok: true` as a real, enumerable
    // property. Assigning it wholesale would leak that discriminant onto a
    // NESTED value object that has no `ok` field of its own — unlike the
    // top-level spread a few lines down in `midiToPitch` and its siblings,
    // which needs exactly one `ok: true`. Destructuring strips it.
    const { cents, semitones, ratio, baseFrequency, resultFrequency, beatHz } = interval;
    intervalToSecond = { cents, semitones, ratio, baseFrequency, resultFrequency, beatHz };
  }
  let shifted: NearestPitch | undefined;
  if (extras.pitchShiftCents !== undefined) {
    if (!isInRange(extras.pitchShiftCents, -12000, 12000)) return fail("pitchShiftCents");
    const shiftedFrequency = frequency * 2 ** (extras.pitchShiftCents / CENTS_PER_OCTAVE);
    shifted = { ...nearestPitchOf(shiftedFrequency, reference, convention), ...NO_EXTRAS };
  }
  return { ok: true, intervalToSecond, shifted };
}

/** The shifted pitch carries no further interval/shift of its own — nothing to chain onto it. */
const NO_EXTRAS: PitchExtraFields = { intervalToSecond: undefined, shifted: undefined };

/**
 * The frequency of a MIDI note number, and the note's name.
 *
 * `f(m) = ref * 2^((m - 69)/12)`. MIDI 60 is C4 under the scientific convention
 * this defaults to, because the octave is `floor(m/12) - 1`; Yamaha hardware
 * calls the same note C3, which is why the convention is a stated choice.
 */
export function midiToPitch(input: MidiPitchInput): ProResult<Pitch> {
  const reference = referenceOf(input.referencePitch);
  if (reference === undefined) return fail("referencePitch");
  if (!isIntegerIn(input.midi, 0, 127)) return fail("midi");
  const convention = octaveConventionOf(input.octaveConvention);
  if (convention === undefined) return fail("octaveConvention");
  const base = describeMidi(input.midi, reference, convention);
  const extras = pitchExtras(base.frequency, reference, convention, input);
  if (!extras.ok) return extras;
  // `extras` already carries `ok: true` (it is a `ProResult`), so spreading it
  // after an explicit `ok: true` would specify the property twice.
  return { ...base, ...extras };
}

/**
 * A written note name, in scientific pitch notation, as a MIDI number and a pitch.
 *
 * `m = (octave + k) * 12 + natural(letter) + accidental`, where `k` is 1 under
 * the scientific convention and 2 under Yamaha's — which is what makes `Cb4`
 * come out as 59 (= B3) and `B#3` as 60 (= C4) with no special case for the
 * octave crossing, under whichever convention is active. Those two spellings can
 * therefore land outside 0..127 at the extremes, and the result says so rather
 * than clamping.
 */
export function pitchFromName(input: NamedPitchInput): ProResult<Pitch> {
  const reference = referenceOf(input.referencePitch);
  if (reference === undefined) return fail("referencePitch");
  const convention = octaveConventionOf(input.octaveConvention);
  if (convention === undefined) return fail("octaveConvention");
  const match = /^([A-Ga-g](?:#{1,2}|b{1,2}|x)?)(-?\d)$/.exec(input.name.trim());
  if (match === null) return fail("name");
  const head = parseLetterAccidental(match[1] ?? "");
  const octave = Number(match[2]);
  if (head === undefined || !isIntegerIn(octave, -1, 9)) return fail("name");
  const midi = (octave + octaveOffset(convention)) * 12 + naturalPc(head.letterIndex) + head.accidental;
  const base = describeMidi(midi, reference, convention);
  const extras = pitchExtras(base.frequency, reference, convention, input);
  if (!extras.ok) return extras;
  return { ...base, ...extras };
}

/**
 * The note nearest a measured frequency, and how far off it is in cents.
 *
 * `cents = (mExact - mNearest) * 100` is identically `1200*log2(f/f(mNearest))`;
 * nothing is rounded before the cent figure is taken, because rounding `mExact`
 * first would move it by up to half a cent — which is the whole reading.
 */
export function pitchFromFrequency(input: FrequencyPitchInput): ProResult<NearestPitch> {
  const reference = referenceOf(input.referencePitch);
  if (reference === undefined) return fail("referencePitch");
  if (!isPositive(input.frequency)) return fail("frequency");
  const convention = octaveConventionOf(input.octaveConvention);
  if (convention === undefined) return fail("octaveConvention");
  const base = nearestPitchOf(input.frequency, reference, convention);
  // `base.frequency` is `frequencyOfMidi` of the QUANTISED nearest note, not
  // the frequency the user measured. Feeding it into `pitchExtras` would
  // silently substitute that repaired value for the input — precisely what
  // this file's own header says it refuses to do — and double-count the note's
  // own detune into `intervalToSecond`/`shifted`. `input.frequency` is already
  // validated positive above, which is all `pitchExtras` requires of it.
  const extras = pitchExtras(input.frequency, reference, convention, input);
  if (!extras.ok) return extras;
  return { ...base, ...extras };
}

export type IntervalEntry =
  | { readonly kind: "frequencies"; readonly a: number; readonly b: number }
  | { readonly kind: "cents"; readonly value: number }
  | { readonly kind: "ratio"; readonly value: number };

export interface CentsRatioInput {
  readonly entry: IntervalEntry;
  /**
   * The base frequency the interval is applied to. Only with it is a resulting
   * frequency reported. The `frequencies` entry carries its own base and ignores it.
   */
  readonly baseFrequency?: number | undefined;
}

export interface CentsRatioResult {
  /** Signed: B below A is negative. */
  readonly cents: number;
  /** cents / 100 — semitones of 12-TET, which is what the cent is defined against. */
  readonly semitones: number;
  readonly ratio: number;
  readonly baseFrequency: number | undefined;
  readonly resultFrequency: number | undefined;
  /**
   * `|base * (ratio - 1)|`, in Hz — undefined without a base frequency. A cent is
   * not a fixed number of Hz: the same 7.85 cents is 3.6 Hz apart at 440 Hz and
   * 90 Hz apart at 11 kHz, and beats are counted in Hz, not in cents.
   */
  readonly beatHz: number | undefined;
}

/**
 * One identity — `cents = 1200*log2(fB/fA)` — solved for whichever field is empty.
 *
 * Nothing is rounded before display. Rounding the ratio to six decimals first
 * and then taking its logarithm moves the cent figure by up to 0.002 cents at
 * audio frequencies, which is visible in the third decimal the surface prints.
 */
export function centsRatio(input: CentsRatioInput): ProResult<CentsRatioResult> {
  const { entry } = input;
  let cents: number;
  let base = input.baseFrequency;
  if (entry.kind === "frequencies") {
    if (!isPositive(entry.a)) return fail("frequencyA");
    if (!isPositive(entry.b)) return fail("frequencyB");
    cents = CENTS_PER_OCTAVE * Math.log2(entry.b / entry.a);
    base = entry.a;
  } else if (entry.kind === "cents") {
    if (!isInRange(entry.value, -12000, 12000)) return fail("cents");
    cents = entry.value;
  } else {
    if (!isPositive(entry.value)) return fail("ratio");
    cents = CENTS_PER_OCTAVE * Math.log2(entry.value);
  }
  if (base !== undefined && !isPositive(base)) return fail("baseFrequency");

  const ratio = 2 ** (cents / CENTS_PER_OCTAVE);
  return {
    ok: true,
    cents,
    semitones: cents / 100,
    ratio,
    baseFrequency: base,
    resultFrequency: base === undefined ? undefined : base * ratio,
    beatHz: base === undefined ? undefined : Math.abs(base * (ratio - 1)),
  };
}

// --- Tempo and time ---------------------------------------------------------

/** A time-signature denominator: the note value the lower number names. */
export type TimeSignatureDenominator = 1 | 2 | 4 | 8 | 16 | 32;

/**
 * The only denominators the arithmetic below is defined for. `denominator`'s
 * compile-time union is not a runtime guarantee — the renderer is untrusted
 * (SEC-EL) and an unchosen select crosses the boundary as `0`, which becomes a
 * divisor a few lines down. Membership is checked before any arithmetic runs.
 */
const TIME_SIGNATURE_DENOMINATORS: readonly TimeSignatureDenominator[] = [1, 2, 4, 8, 16, 32];

/**
 * What ONE beat of the typed BPM actually names.
 *
 * `quarter` is the ordinary case BPM is usually understood as. But in a compound
 * signature such as 6/8 many musicians and DAWs state tempo in DOTTED quarters —
 * treating that number as plain quarters is quietly wrong by a factor of 1.5 —
 * and some surfaces state the tempo directly in the denominator's own note value.
 * The formula does not change; only which note the number is COUNTING does, so
 * this has to be an explicit choice rather than a silent assumption.
 */
export type BpmReference = "quarter" | "dotted-quarter" | "denominator-unit";

export interface BarTimingInput {
  /** Beats per minute, counting whatever `bpmReference` names. */
  readonly bpm: number;
  readonly numerator: number;
  readonly denominator: TimeSignatureDenominator;
  /** Default `quarter` — see `BpmReference`. */
  readonly bpmReference?: BpmReference | undefined;
}

export interface BarDurationInput extends BarTimingInput {
  /** May be fractional: 2.5 bars is a real edit point. */
  readonly bars: number;
}

export interface BarDurationResult {
  readonly seconds: number;
  /** mm:ss.mmm, or HH:MM:SS.mmm past an hour. */
  readonly formatted: string;
  readonly secondsPerBar: number;
  /** One unit of whatever the denominator names — an eighth in 6/8, not a quarter. */
  readonly secondsPerBeatUnit: number;
}

function barTiming(input: BarTimingInput): ProResult<{
  readonly secondsPerBeatUnit: number;
  readonly secondsPerBar: number;
}> {
  if (!isInRange(input.bpm, 1, 999)) return fail("bpm");
  if (!isIntegerIn(input.numerator, 1, 64)) return fail("numerator");
  if (!TIME_SIGNATURE_DENOMINATORS.includes(input.denominator)) return fail("denominator");
  const reference = input.bpmReference ?? "quarter";
  if (!isOneOf(reference, ["quarter", "dotted-quarter", "denominator-unit"] as const)) {
    return fail("bpmReference");
  }

  // Written as ONE fraction rather than building up through an intermediate
  // seconds-per-quarter value. The three-step form leaves 16 bars of 6/8 at
  // 90 BPM at 31.999999999999996 s, and a clock that truncates its milliseconds
  // — as this one deliberately does — renders that as 00:31.999. The arithmetic
  // was right and the answer was still wrong, which is what an intermediate
  // rounding always looks like.
  //
  // `quarter`: the unit the denominator names lasts 4/denominator of a beat.
  // `dotted-quarter`: one beat IS 1.5 quarters, so the denominator's unit lasts
  // (4/denominator)/1.5 of a beat.
  // `denominator-unit`: the beat already IS the denominator's unit; nothing to
  // convert, so a beat lasts exactly 60/BPM regardless of numerator or denominator.
  if (reference === "denominator-unit") {
    const secondsPerBeatUnit = 60 / input.bpm;
    return { ok: true, secondsPerBeatUnit, secondsPerBar: input.numerator * secondsPerBeatUnit };
  }
  const beatUnits = input.bpm * input.denominator * (reference === "dotted-quarter" ? 1.5 : 1);
  return {
    ok: true,
    secondsPerBeatUnit: (60 * 4) / beatUnits,
    secondsPerBar: (60 * 4 * input.numerator) / beatUnits,
  };
}

/**
 * How long a number of bars lasts at a tempo and a time signature.
 *
 * The denominator is not decoration: 16 bars of 6/8 at 90 BPM is 32 s, while the
 * same bars read as 6/4 would be 64 s. Treating the numerator as „beats per bar"
 * and multiplying by 60/BPM gets 6/8 wrong by a factor of two.
 */
export function barDuration(input: BarDurationInput): ProResult<BarDurationResult> {
  const timing = barTiming(input);
  if (!timing.ok) return timing;
  if (!isInRange(input.bars, 0, 100000)) return fail("bars");
  const seconds = input.bars * timing.secondsPerBar;
  return {
    ok: true,
    seconds,
    formatted: formatDuration(seconds),
    secondsPerBar: timing.secondsPerBar,
    secondsPerBeatUnit: timing.secondsPerBeatUnit,
  };
}

export interface BarCountInput extends BarTimingInput {
  readonly seconds: number;
}

export interface BarCountResult {
  /** WHOLE bars that fit; the remainder is reported separately, never rounded in. */
  readonly bars: number;
  readonly remainderSeconds: number;
  /** The remainder in units the denominator names — 2.000 doba, not 2.000 quarters. */
  readonly remainderBeats: number;
  readonly remainderMs: number;
  readonly secondsPerBar: number;
  readonly secondsPerBeatUnit: number;
}

/**
 * The other direction: how many whole bars fit in a duration, and what is left.
 *
 * Two functions rather than one with two optional fields, so the pane cannot
 * hold two contradictory answers at once — filling one direction in the surface
 * clears the other, and here the two directions cannot even be asked together.
 */
export function barsInDuration(input: BarCountInput): ProResult<BarCountResult> {
  const timing = barTiming(input);
  if (!timing.ok) return timing;
  if (!isInRange(input.seconds, 0, 1e7)) return fail("seconds");
  const bars = Math.floor(input.seconds / timing.secondsPerBar);
  const remainderSeconds = input.seconds - bars * timing.secondsPerBar;
  return {
    ok: true,
    bars,
    remainderSeconds,
    remainderBeats: remainderSeconds / timing.secondsPerBeatUnit,
    remainderMs: remainderSeconds * 1000,
    secondsPerBar: timing.secondsPerBar,
    secondsPerBeatUnit: timing.secondsPerBeatUnit,
  };
}

/** The note values the delay table carries; a denominator of n fits n times into a whole. */
export type NoteDenominator = 1 | 2 | 4 | 8 | 16 | 32 | 64;

/** straight = 1, dotted = 3/2 (the dot adds half the written value), triplet = 2/3. */
export type NoteModifier = "straight" | "dotted" | "triplet";

const NOTE_DENOMINATORS: readonly NoteDenominator[] = [1, 2, 4, 8, 16, 32, 64];

/**
 * The dot adds half the written value; a triplet fits three into the span of two.
 *
 * Applied as a fraction and not as a precomputed factor: 234.375 ms times the
 * double nearest 2/3 is 156.24999999999997, while (234.375 * 2) / 3 is exactly
 * 156.25 — and the 1/64 row is where that difference becomes visible.
 */
function applyModifier(milliseconds: number, modifier: NoteModifier): number {
  if (modifier === "dotted") return (milliseconds * 3) / 2;
  if (modifier === "triplet") return (milliseconds * 2) / 3;
  return milliseconds;
}

export interface DelayTimesInput {
  /** May be fractional — 128.5 BPM is a real setting and nothing here assumes an integer. */
  readonly bpm: number;
  /** Which row the surface highlights. Default 1/4 — a selector, not a measurement. */
  readonly denominator?: NoteDenominator | undefined;
  readonly modifier?: NoteModifier | undefined;
}

export interface DelayCell {
  readonly milliseconds: number;
  /** 1000 / ms — the LFO rate that matches this delay. */
  readonly hertz: number;
}

export interface DelayRow {
  readonly denominator: NoteDenominator;
  readonly straight: DelayCell;
  readonly dotted: DelayCell;
  readonly triplet: DelayCell;
}

export interface DelayTimesResult {
  /** One quarter note, in ms. Carried at full precision — see the note below. */
  readonly beatMs: number;
  readonly rows: readonly DelayRow[];
  readonly selected: DelayCell;
  readonly selectedDenominator: NoteDenominator;
  readonly selectedModifier: NoteModifier;
}

/**
 * The whole delay-time table for one tempo: every note value, straight, dotted
 * and triplet, in milliseconds and as the LFO rate that matches it.
 *
 * **No intermediate rounding.** `beatMs` is carried at full double precision and
 * rounding happens only where the surface prints; rounding 60000/90 to 666.667
 * first puts the 1/64 row out by a third of a millisecond, which is audible as a
 * drifting delay against the grid.
 */
export function delayTimes(input: DelayTimesInput): ProResult<DelayTimesResult> {
  if (!isInRange(input.bpm, 1, 999)) return fail("bpm");
  const denominator = input.denominator ?? 4;
  // `rows` is safe regardless — it iterates NOTE_DENOMINATORS itself — but
  // `selected` is built from the caller's own value, which crosses the
  // untrusted renderer boundary (SEC-EL) as `0` when nothing is chosen.
  if (!NOTE_DENOMINATORS.includes(denominator)) return fail("denominator");
  const modifier = input.modifier ?? "straight";
  const beatMs = 60000 / input.bpm;
  const cell = (note: NoteDenominator, modifierKind: NoteModifier): DelayCell => {
    const milliseconds = applyModifier((beatMs * 4) / note, modifierKind);
    return { milliseconds, hertz: 1000 / milliseconds };
  };
  return {
    ok: true,
    beatMs,
    rows: NOTE_DENOMINATORS.map((note) => ({
      denominator: note,
      straight: cell(note, "straight"),
      dotted: cell(note, "dotted"),
      triplet: cell(note, "triplet"),
    })),
    selected: cell(denominator, modifier),
    selectedDenominator: denominator,
    selectedModifier: modifier,
  };
}

export interface DelayTempoInput {
  /** A measured delay time, ms — off an external unit or a stem of unknown tempo. */
  readonly measuredMs: number;
}

export interface DelayTempoCell {
  readonly straightBpm: number;
  readonly dottedBpm: number;
  readonly tripletBpm: number;
}

export interface DelayTempoRow {
  readonly denominator: NoteDenominator;
  readonly bpm: DelayTempoCell;
}

export interface DelayTempoResult {
  readonly rows: readonly DelayTempoRow[];
}

/**
 * The inverse of `delayTimes`: the tempo at which a MEASURED delay is each note
 * value, straight, dotted and triplet.
 *
 * This is the direction that matters when syncing to an outboard delay or a stem
 * of unknown tempo — `delayTimes` answers „what does this tempo give me", and this
 * answers „what tempo gives me this". Solved from the same identity: `ms =
 * (60000/bpm) * (4/denominator) * multiplier`, so `bpm = 240000 * multiplier /
 * (denominator * ms)`.
 */
export function delayTimesFromMeasuredMs(input: DelayTempoInput): ProResult<DelayTempoResult> {
  if (!isPositive(input.measuredMs)) return fail("measuredMs");
  const bpmFor = (denominator: NoteDenominator, modifierKind: NoteModifier): number => {
    const multiplier = modifierKind === "dotted" ? 1.5 : modifierKind === "triplet" ? 2 / 3 : 1;
    return (240000 * multiplier) / (denominator * input.measuredMs);
  };
  return {
    ok: true,
    rows: NOTE_DENOMINATORS.map((denominator) => ({
      denominator,
      bpm: {
        straightBpm: bpmFor(denominator, "straight"),
        dottedBpm: bpmFor(denominator, "dotted"),
        tripletBpm: bpmFor(denominator, "triplet"),
      },
    })),
  };
}

// --- Acoustics --------------------------------------------------------------

export type SoundWaveEntry =
  | { readonly kind: "frequency"; readonly value: number }
  | { readonly kind: "wavelength"; readonly value: number };

export interface SoundWavelengthInput {
  readonly entry: SoundWaveEntry;
  /** Air temperature in °C, -50..+60. Default 20. Ignored when `speedOverride` is given. */
  readonly temperature?: number | undefined;
  /** Metres; only with it is a propagation delay reported. */
  readonly distance?: number | undefined;
  /**
   * A directly measured speed of sound, m/s — overrides the dry-air `c(T)` model.
   * 331.3 m/s at 0 °C is itself a MEASURED figure (sources disagree in the fourth
   * digit), and the temperature field alone can say nothing about humid air or a
   * medium that is not air at all; this is the escape hatch for anyone who
   * measured their own environment instead of trusting the dry-air model of it.
   */
  readonly speedOverride?: number | undefined;
}

export interface SoundWavelengthResult {
  readonly speedOfSound: number;
  readonly frequency: number;
  readonly wavelength: number;
  readonly halfWavelength: number;
  /** Quarter wavelength — the depth a porous absorber has to reach for that frequency. */
  readonly quarterWavelength: number;
  readonly delayPerMetreMs: number;
  readonly delayMs: number | undefined;
}

/**
 * Wavelength and speed of sound at a stated air temperature, either direction.
 *
 * The temperature is in the answer rather than baked into a 343 m/s constant,
 * because the same 100 Hz is 3.43 m in a warm room and 3.31 m outdoors at 0 °C —
 * a 3.6 % difference that decides where a quarter-wave trap actually sits.
 */
export function soundWavelength(input: SoundWavelengthInput): ProResult<SoundWavelengthResult> {
  const { distance, speedOverride } = input;
  if (distance !== undefined && !isNonNegative(distance)) return fail("distance");
  let speed: number;
  if (speedOverride !== undefined) {
    if (!isPositive(speedOverride)) return fail("speedOverride");
    speed = speedOverride;
  } else {
    const temperature = input.temperature ?? 20;
    if (!isInRange(temperature, -50, 60)) return fail("temperature");
    speed = speedOfSound(temperature);
  }

  const { entry } = input;
  let frequency: number;
  let wavelength: number;
  if (entry.kind === "frequency") {
    if (!isPositive(entry.value)) return fail("frequency");
    frequency = entry.value;
    wavelength = speed / frequency;
  } else {
    if (!isPositive(entry.value)) return fail("wavelength");
    wavelength = entry.value;
    frequency = speed / wavelength;
  }
  return {
    ok: true,
    speedOfSound: speed,
    frequency,
    wavelength,
    halfWavelength: wavelength / 2,
    quarterWavelength: wavelength / 4,
    delayPerMetreMs: 1000 / speed,
    delayMs: distance === undefined ? undefined : (distance / speed) * 1000,
  };
}

/**
 * The octave bands a real absorption data sheet is published in.
 *
 * A single broadband alpha implies a material that absorbs the same at 125 Hz
 * and at 4 kHz, which no material does — carpet and heavy drape are the two most
 * common counterexamples, and this is exactly why an estimate that used one
 * would be silently wrong at both ends of the spectrum.
 */
const REVERB_BANDS = [125, 250, 500, 1000, 2000, 4000] as const;
export type ReverbBand = (typeof REVERB_BANDS)[number];

export interface AbsorptionSurface {
  /** m². */
  readonly area: number;
  /**
   * Absorption coefficient at each octave band, 0..1. NO material table is
   * embedded: alpha belongs to a specific product's data sheet, is read per
   * band, and changes with how the material is mounted. It is the user's number
   * and the surface says so beside the answer.
   */
  readonly alpha125: number;
  readonly alpha250: number;
  readonly alpha500: number;
  readonly alpha1000: number;
  readonly alpha2000: number;
  readonly alpha4000: number;
}

export interface ReverbTimeInput {
  /** m³. A room given as L×W×H is that product — the multiplication is the surface's. */
  readonly volume: number;
  /** 1..64 rows. */
  readonly surfaces: readonly AbsorptionSurface[];
  /** °C, -50..+60. Default 20. Feeds the speed of sound, which is in every band's formula. */
  readonly temperature?: number | undefined;
  /**
   * Air absorption coefficient m, per metre, >= 0 — PER OCTAVE BAND, the same
   * shape as `AbsorptionSurface`'s own `alpha125`..`alpha4000`, and for the
   * same reason: a single figure across all six bands would repeat exactly the
   * mistake this file's own reverb-band comment argues against one paragraph
   * up ("a single broadband alpha implies a material that absorbs the same at
   * 125 Hz and at 4 kHz, which no material does") — air absorption varies with
   * frequency far MORE than alpha does, growing by roughly two orders of
   * magnitude from 125 Hz to 4 kHz in ordinary humidity. NO default and NOT
   * embedded: it depends on humidity and temperature as well as the band, and
   * above roughly 2 kHz in a large room it dominates the total. Each band is
   * independent — a coefficient absent for one band leaves that band's
   * `sabineWithAir` undefined without withholding any other band's.
   */
  readonly airAbsorption?: AirAbsorptionCoefficients | undefined;
}

/** `m`, per metre, at each octave band — see `ReverbTimeInput.airAbsorption`. */
export interface AirAbsorptionCoefficients {
  readonly at125?: number | undefined;
  readonly at250?: number | undefined;
  readonly at500?: number | undefined;
  readonly at1000?: number | undefined;
  readonly at2000?: number | undefined;
  readonly at4000?: number | undefined;
}

export interface ReverbBandResult {
  readonly band: ReverbBand;
  /** A, in m² sabins, for this band. */
  readonly absorption: number;
  readonly averageAlpha: number;
  /** Seconds; undefined when nothing absorbs in this band — infinity is not an answer. */
  readonly sabine: number | undefined;
  /** Sabine with the `4mV` air term; undefined without THIS band's own coefficient. */
  readonly sabineWithAir: number | undefined;
  /** Seconds; undefined at alphaBar 0 or 1, where ln(1 - alphaBar) has no usable value. */
  readonly eyring: number | undefined;
}

export interface ReverbTimeResult {
  readonly speedOfSound: number;
  readonly totalArea: number;
  readonly bands: readonly ReverbBandResult[];
}

const REVERB_ALPHA_FIELD: Record<ReverbBand, keyof AbsorptionSurface> = {
  125: "alpha125",
  250: "alpha250",
  500: "alpha500",
  1000: "alpha1000",
  2000: "alpha2000",
  4000: "alpha4000",
};

const AIR_ABSORPTION_FIELD: Record<ReverbBand, keyof AirAbsorptionCoefficients> = {
  125: "at125",
  250: "at250",
  500: "at500",
  1000: "at1000",
  2000: "at2000",
  4000: "at4000",
};

/**
 * RT60 by Sabine and by Eyring, per octave band, from the user's own coefficients.
 *
 * **They disagree on purpose.** Eyring lies below Sabine for every mean alpha in
 * (0,1) and the gap widens as the room gets deader; showing one of them alone
 * would be this tool picking a model for a room it has not seen. At alphaBar = 1
 * Eyring has no value at all while Sabine still returns a finite figure, and
 * that divergence is reported rather than papered over with a large number.
 *
 * **Sabine itself is a diffuse-field model** and is known to break down above
 * roughly alphaBar = 0.2 — which is exactly why Eyring is computed alongside it
 * rather than presented as a correction nobody can see the size of.
 */
export function reverbTime(input: ReverbTimeInput): ProResult<ReverbTimeResult> {
  const temperature = input.temperature ?? 20;
  if (!isInRange(temperature, -50, 60)) return fail("temperature");
  if (!isPositive(input.volume)) return fail("volume");
  const { surfaces, airAbsorption } = input;
  if (surfaces.length < 1 || surfaces.length > 64) return fail("surfaces");
  for (const band of REVERB_BANDS) {
    const m = airAbsorption?.[AIR_ABSORPTION_FIELD[band]];
    if (m !== undefined && !isNonNegative(m)) return fail(AIR_ABSORPTION_FIELD[band]);
  }

  let totalArea = 0;
  for (const surface of surfaces) {
    if (!isPositive(surface.area)) return fail("area");
    for (const band of REVERB_BANDS) {
      const alpha = surface[REVERB_ALPHA_FIELD[band]];
      if (!isInRange(alpha, 0, 1)) return fail(REVERB_ALPHA_FIELD[band]);
    }
    totalArea += surface.area;
  }

  const speed = speedOfSound(temperature);
  const numerator = RT60_FACTOR * input.volume;
  const bands: ReverbBandResult[] = REVERB_BANDS.map((band) => {
    const field = REVERB_ALPHA_FIELD[band];
    let absorption = 0;
    for (const surface of surfaces) absorption += surface.area * surface[field];
    const averageAlpha = absorption / totalArea;
    const airM = airAbsorption?.[AIR_ABSORPTION_FIELD[band]];
    const airTerm = airM === undefined ? 0 : 4 * airM * input.volume;
    return {
      band,
      absorption,
      averageAlpha,
      sabine: absorption > 0 ? numerator / (speed * absorption) : undefined,
      sabineWithAir:
        airM === undefined
          ? undefined
          : absorption + airTerm > 0
            ? numerator / (speed * (absorption + airTerm))
            : undefined,
      eyring:
        averageAlpha > 0 && averageAlpha < 1
          ? numerator / (-speed * totalArea * Math.log(1 - averageAlpha))
          : undefined,
    };
  });

  return { ok: true, speedOfSound: speed, totalArea, bands };
}

/** How many of p, q, r are non-zero: one axis, two, or all three. */
export type RoomModeType = "axial" | "tangential" | "oblique";

export interface RoomModesInput {
  /** Metres, 0.5..100. */
  readonly length: number;
  readonly width: number;
  /** Metres, 0.5..30. */
  readonly height: number;
  /** °C, -50..+60. Default 20. */
  readonly temperature?: number | undefined;
  /** Hz, 20..1000. Default 300 — modes matter where the room is not diffuse. */
  readonly frequencyLimit?: number | undefined;
  /** 1..8. Default 4. */
  readonly maxOrder?: number | undefined;
}

export interface RoomMode {
  readonly p: number;
  readonly q: number;
  readonly r: number;
  readonly frequency: number;
  readonly type: RoomModeType;
  /** Hz to the previous mode in the list; undefined for the first row. */
  readonly spacing: number | undefined;
}

export interface RoomModesResult {
  readonly speedOfSound: number;
  readonly modes: readonly RoomMode[];
}

/**
 * Rayleigh's modal frequencies for a rigid rectangular box, sorted, with the gap
 * to the previous mode beside each.
 *
 * **The idealisation is the point and the limit at once.** These are the modes of
 * a rigid-walled empty box; a real room has doors, windows, furniture and walls
 * that move, and the surface says so instead of implying the list describes the
 * room the user is standing in. Degenerate modes — a cube, or any two equal
 * dimensions — produce identical frequencies and a spacing of 0.00 Hz, which is
 * a real and useful result and is therefore never deduplicated away.
 */
export function roomModes(input: RoomModesInput): ProResult<RoomModesResult> {
  const temperature = input.temperature ?? 20;
  const limit = input.frequencyLimit ?? 300;
  const maxOrder = input.maxOrder ?? 4;
  if (!isInRange(input.length, 0.5, 100)) return fail("length");
  if (!isInRange(input.width, 0.5, 100)) return fail("width");
  if (!isInRange(input.height, 0.5, 30)) return fail("height");
  if (!isInRange(temperature, -50, 60)) return fail("temperature");
  if (!isInRange(limit, 20, 1000)) return fail("frequencyLimit");
  if (!isIntegerIn(maxOrder, 1, 8)) return fail("maxOrder");

  const speed = speedOfSound(temperature);
  const half = speed / 2;
  const found: { p: number; q: number; r: number; frequency: number; type: RoomModeType }[] = [];
  for (let p = 0; p <= maxOrder; p += 1) {
    for (let q = 0; q <= maxOrder; q += 1) {
      for (let r = 0; r <= maxOrder; r += 1) {
        if (p === 0 && q === 0 && r === 0) continue;
        const frequency =
          half *
          Math.sqrt(
            (p / input.length) ** 2 + (q / input.width) ** 2 + (r / input.height) ** 2,
          );
        if (frequency > limit) continue;
        const axes = (p > 0 ? 1 : 0) + (q > 0 ? 1 : 0) + (r > 0 ? 1 : 0);
        const type: RoomModeType = axes === 1 ? "axial" : axes === 2 ? "tangential" : "oblique";
        found.push({ p, q, r, frequency, type });
      }
    }
  }
  found.sort((a, b) => a.frequency - b.frequency);
  return {
    ok: true,
    speedOfSound: speed,
    modes: found.map((mode, index) => ({
      ...mode,
      spacing: index === 0 ? undefined : mode.frequency - (found[index - 1]?.frequency ?? 0),
    })),
  };
}

export interface SpeakerCabinet {
  /** Nominal impedance in ohm, read off the cabinet. */
  readonly impedance: number;
  /** Series group, 1..8. Required by the series-parallel wiring, ignored by the others. */
  readonly group?: number | undefined;
}

export type SpeakerWiring = "parallel" | "series" | "series-parallel";

export interface SpeakerLoadInput {
  /** 1..32 cabinets. */
  readonly cabinets: readonly SpeakerCabinet[];
  readonly wiring: SpeakerWiring;
  /** Watts the amplifier delivers into the resulting load, from its own power table. */
  readonly power?: number | undefined;
  /**
   * The minimum load the amplifier is rated for, in ohm — the user's own figure,
   * read off their own amplifier.
   *
   * `regulated` tier: NEVER embedded and NEVER defaulted. It decides whether
   * hardware overheats, it differs per amplifier and per bridging mode, and a
   * number this app invented would become the user's safety margin.
   */
  readonly minimumLoad?: number | undefined;
}

export interface SpeakerCabinetLoad {
  readonly impedance: number;
  /** Share of the total power, in percent. */
  readonly sharePercent: number;
  /** Watts; undefined when no delivered power was stated. */
  readonly power: number | undefined;
}

export interface SpeakerLoadResult {
  readonly totalImpedance: number;
  /** Vrms across the whole load; undefined without a stated power. */
  readonly driveVoltage: number | undefined;
  readonly cabinets: readonly SpeakerCabinetLoad[];
  /** The user's own figure, echoed so the surface prints it as theirs. */
  readonly minimumLoad: number | undefined;
  /** totalImpedance ÷ the user's minimum. A ratio, and nothing follows from it here. */
  readonly loadRatio: number | undefined;
}

/**
 * Total impedance of a speaker load and the power each cabinet takes.
 *
 * **One formula, not three.** Parallel is „every cabinet in its own group",
 * series is „all cabinets in one group", and series-parallel is the user's
 * groups; then `Ztotal = 1 / sum(1/Zgroup)` and each cabinet sees its group's
 * current. Three hand-written topologies would be three chances to apply the
 * wrong one, and the wrong one is silently plausible — a series string looks
 * fine until the shares come out inverted.
 *
 * **No verdict.** The minimum rated load is the user's typed number; what comes
 * back is the computed impedance, that number, and their ratio. Nothing here
 * says whether an amplifier will survive the load, because that answer depends
 * on the amplifier, on the bridging mode and on the programme material.
 */
export function speakerLoad(input: SpeakerLoadInput): ProResult<SpeakerLoadResult> {
  const { cabinets, wiring } = input;
  if (cabinets.length < 1 || cabinets.length > 32) return fail("cabinets");
  const { power, minimumLoad } = input;
  if (power !== undefined && !isPositive(power)) return fail("power");
  // regulated tier, echoed verbatim below — but echoing an unvalidated figure
  // is this file's own repair-by-omission, the doctrine it exists to refuse.
  if (minimumLoad !== undefined && !isPositive(minimumLoad)) return fail("minimumLoad");

  const groupKeys: number[] = [];
  const groupImpedance = new Map<number, number>();
  for (const [index, cabinet] of cabinets.entries()) {
    if (!isPositive(cabinet.impedance)) return fail("impedance");
    let key: number;
    if (wiring === "parallel") key = index;
    else if (wiring === "series") key = 0;
    else {
      if (cabinet.group === undefined || !isIntegerIn(cabinet.group, 1, 8)) return fail("group");
      key = cabinet.group;
    }
    groupKeys.push(key);
    groupImpedance.set(key, (groupImpedance.get(key) ?? 0) + cabinet.impedance);
  }

  let admittance = 0;
  for (const impedance of groupImpedance.values()) admittance += 1 / impedance;
  const totalImpedance = 1 / admittance;
  const driveVoltage = power === undefined ? undefined : Math.sqrt(power * totalImpedance);

  const loaded = cabinets.map((cabinet, index): SpeakerCabinetLoad => {
    // Every group hangs across the same voltage, so the current inside a group is
    // V/Zgroup and each element takes I²Z. That collapses to V²/Z for a lone
    // cabinet in parallel and to I²Z along a series string, with no branching.
    const group = groupImpedance.get(groupKeys[index] ?? 0) ?? cabinet.impedance;
    const current = driveVoltage === undefined ? undefined : driveVoltage / group;
    return {
      impedance: cabinet.impedance,
      sharePercent: ((cabinet.impedance * totalImpedance) / (group * group)) * 100,
      power: current === undefined ? undefined : current ** 2 * cabinet.impedance,
    };
  });

  return {
    ok: true,
    totalImpedance,
    driveVoltage,
    cabinets: loaded,
    minimumLoad,
    loadRatio: ratioAgainst(totalImpedance, minimumLoad),
  };
}

/**
 * Which figure the cabinet's data sheet actually printed.
 *
 * A datasheet giving „dB @ 2.83 V/1 m" is only „dB @ 1 W/1 m" on an 8 ohm box: at
 * 2.83 V a 4 ohm cabinet dissipates 2 W, not 1, so reading that number as 1 W
 * overstates it by 10*log10(2) = 3.01 dB — precisely on the cabinets people
 * actually buy. The conversion needs the cabinet's own nominal impedance to do it.
 */
export type SplSensitivityReference = "1w" | "2.83v";

export interface SplInput {
  /** dB SPL at the reference distance, AS PRINTED on the cabinet's data sheet. 70..120. */
  readonly sensitivity: number;
  /** What `sensitivity` was measured at. Default `1w`. */
  readonly sensitivityReference?: SplSensitivityReference | undefined;
  /** Ohm — required only when `sensitivityReference` is `2.83v`. */
  readonly nominalImpedance?: number | undefined;
  /** Watts applied. */
  readonly power: number;
  /** Metres. */
  readonly distance: number;
  /** Metres; default 1 — the distance the sensitivity figure was quoted at. */
  readonly referenceDistance?: number | undefined;
  /** Metres; only with it is the two-distance difference reported. */
  readonly secondDistance?: number | undefined;
  /**
   * The sound-level limit the user is working to, in dB.
   *
   * `regulated` tier: NEVER embedded and NEVER defaulted. A venue rule, a permit
   * condition, an employer's policy and a national noise regulation are four
   * different numbers with four different weightings, all chosen by rule-makers
   * who can change them. It is the user's figure and it is labelled as theirs.
   */
  readonly limit?: number | undefined;
}

export interface SplResult {
  /** `sensitivity` converted to the 1 W/1 m basis every formula below uses. */
  readonly sensitivity1W: number;
  readonly level: number;
  /** 10*log10(P) — power is a power quantity, so the factor is 10. */
  readonly powerTermDb: number;
  /** 20*log10(d/dRef) — pressure is a root-power quantity, so the factor is 20. */
  readonly distanceLossDb: number;
  readonly secondLevel: number | undefined;
  /** Level at the second distance minus the level at the first; negative when farther. */
  readonly secondDifferenceDb: number | undefined;
  readonly limit: number | undefined;
  /** Computed level minus the user's own limit, in dB. Signed, and nothing more. */
  readonly limitDifferenceDb: number | undefined;
  /** The same comparison as a linear sound-pressure ratio, 10^(difference/20). */
  readonly limitPressureRatio: number | undefined;
}

/**
 * Sound pressure level at a distance, for a stated sensitivity and power.
 *
 * **The two logarithms carry different factors and swapping them is the classic
 * error here**: power contributes `10*log10(P)` because power is a power
 * quantity, distance costs `20*log10(d/dRef)` because pressure is a root-power
 * quantity. Doubling the distance is therefore always -6.0206 dB.
 *
 * **No verdict.** The limit is the user's typed number; what comes back is the
 * computed level, that number and their difference in dB. The model is a point
 * source in a free field: indoors the reverberant field stops the inverse-square
 * law past the critical distance, and directivity, array coupling, air
 * absorption and power compression are all outside it. No fudge factor is
 * invented to paper over that, because an invented factor would look like an
 * answer and be a guess.
 */
export function splAtDistance(input: SplInput): ProResult<SplResult> {
  const referenceDistance = input.referenceDistance ?? 1;
  const sensitivityReference = input.sensitivityReference ?? "1w";
  if (!isOneOf(sensitivityReference, ["1w", "2.83v"] as const)) return fail("sensitivityReference");
  if (!isInRange(input.sensitivity, 70, 120)) return fail("sensitivity");
  if (!isPositive(input.power)) return fail("power");
  if (!isPositive(input.distance)) return fail("distance");
  if (!isPositive(referenceDistance)) return fail("referenceDistance");
  const { secondDistance, limit } = input;
  if (secondDistance !== undefined && !isPositive(secondDistance)) return fail("secondDistance");
  // regulated tier, echoed verbatim below beside the computed level — an
  // unvalidated echo is exactly the repair-by-omission this file refuses.
  if (limit !== undefined && !isInRange(limit, 0, 140)) return fail("limit");

  let sensitivity1W: number;
  if (sensitivityReference === "2.83v") {
    const { nominalImpedance } = input;
    if (nominalImpedance === undefined || !isPositive(nominalImpedance)) {
      return fail("nominalImpedance");
    }
    // 2.83 V into Z dissipates 2.83²/Z = 8/Z watts; „1 W" only when Z = 8 ohm.
    sensitivity1W = input.sensitivity - 10 * Math.log10(8 / nominalImpedance);
  } else {
    sensitivity1W = input.sensitivity;
  }

  const powerTermDb = 10 * Math.log10(input.power);
  const distanceLossDb = 20 * Math.log10(input.distance / referenceDistance);
  const level = sensitivity1W + powerTermDb - distanceLossDb;

  const secondDifferenceDb =
    secondDistance === undefined ? undefined : -20 * Math.log10(secondDistance / input.distance);

  // Both figures are logarithmic, so their quotient (96.97/95) would be a number
  // about the notation rather than about the sound; the ratio is taken on the
  // linear pressures the two dB figures stand for, and the dB difference — which
  // IS that ratio, in the unit the quantity lives in — is reported beside it.
  const limitPressure = limit === undefined ? undefined : 10 ** (limit / 20);
  return {
    ok: true,
    sensitivity1W,
    level,
    powerTermDb,
    distanceLossDb,
    secondLevel: secondDifferenceDb === undefined ? undefined : level + secondDifferenceDb,
    secondDifferenceDb,
    limit,
    limitDifferenceDb: limit === undefined ? undefined : level - limit,
    limitPressureRatio: ratioAgainst(10 ** (level / 20), limitPressure),
  };
}

// --- Digital audio ----------------------------------------------------------

/** Sample word width. 32-bit float and 32-bit integer are both four bytes. */
export type BitDepth = 8 | 16 | 24 | 32;

/**
 * The only word widths the arithmetic below is defined for. `bitDepth`'s
 * compile-time union is not a runtime guarantee — the renderer is untrusted
 * (SEC-EL) and an unchosen select crosses the boundary as `0`, which becomes a
 * divisor in `pcmRates`. Membership is checked before any arithmetic runs.
 */
const BIT_DEPTHS: readonly BitDepth[] = [8, 16, 24, 32];

/** Canonical PCM WAV header, 44 B (IBM/Microsoft RIFF 1.0, August 1991, 16-byte fmt). */
const WAV_HEADER_BYTES = 44;

/** A 32-bit RIFF size field cannot address past this, so a longer take needs RF64/W64. */
const WAV_MAX_BYTES = 2 ** 32 - 1;

export interface PcmFormat {
  /** Hz, 1000..768000. */
  readonly sampleRate: number;
  readonly bitDepth: BitDepth;
  /** 1..256. */
  readonly channels: number;
  /** Tracks in a session estimate, 1..1000. Default 1. */
  readonly tracks?: number | undefined;
  /** Default false. The header is per FILE, so n tracks add 44*n, not 44. */
  readonly includeHeader?: boolean | undefined;
}

export interface PcmSizeInput extends PcmFormat {
  readonly seconds: number;
}

export interface PcmSizeResult {
  readonly bytes: number;
  /** 44 per track when the header is included, 0 otherwise — shown as its own item. */
  readonly headerBytes: number;
  readonly bytesPerSecond: number;
  readonly bitrateKbps: number;
  /** Decimal prefixes (IEC 80000-13): what a drive is sold in. */
  readonly megabytes: number;
  readonly gigabytes: number;
  /** Binary prefixes: what the operating system reports. */
  readonly mebibytes: number;
  readonly gibibytes: number;
  /** Total passes what a 32-bit RIFF size field can address — a fact about the format. */
  readonly exceedsWav32BitRange: boolean;
}

function pcmRates(format: PcmFormat): ProResult<{
  readonly bytesPerSecond: number;
  readonly bitrateKbps: number;
  readonly tracks: number;
  readonly headerBytes: number;
}> {
  if (!isInRange(format.sampleRate, 1000, 768000)) return fail("sampleRate");
  if (!BIT_DEPTHS.includes(format.bitDepth)) return fail("bitDepth");
  if (!isIntegerIn(format.channels, 1, 256)) return fail("channels");
  const tracks = format.tracks ?? 1;
  if (!isIntegerIn(tracks, 1, 1000)) return fail("tracks");
  // 24-bit is three packed bytes, which is what a WAV actually writes — treating
  // it as four would overstate a day's tracking by a third.
  const bytesPerSample = format.bitDepth / 8;
  return {
    ok: true,
    bytesPerSecond: format.sampleRate * bytesPerSample * format.channels,
    bitrateKbps: (format.sampleRate * format.bitDepth * format.channels) / 1000,
    tracks,
    headerBytes: format.includeHeader === true ? WAV_HEADER_BYTES * tracks : 0,
  };
}

/**
 * How much room an uncompressed take needs, and at what data rate.
 *
 * Both prefix families are reported because both are true: 39 690 000 B is
 * 39.690 MB on the box the drive came in and 37.851 MiB in the file manager, and
 * a tool that prints one of them alone is the reason that difference reads as a
 * missing gigabyte.
 */
export function pcmSize(input: PcmSizeInput): ProResult<PcmSizeResult> {
  const rates = pcmRates(input);
  if (!rates.ok) return rates;
  if (!isNonNegative(input.seconds)) return fail("seconds");
  const bytes = rates.bytesPerSecond * input.seconds * rates.tracks + rates.headerBytes;
  return {
    ok: true,
    bytes,
    headerBytes: rates.headerBytes,
    bytesPerSecond: rates.bytesPerSecond,
    bitrateKbps: rates.bitrateKbps,
    megabytes: bytes / 1e6,
    gigabytes: bytes / 1e9,
    mebibytes: bytes / 2 ** 20,
    gibibytes: bytes / 2 ** 30,
    exceedsWav32BitRange: bytes > WAV_MAX_BYTES,
  };
}

export interface PcmDurationInput extends PcmFormat {
  readonly bytes: number;
}

export interface PcmDurationResult {
  readonly seconds: number;
  /** HH:MM:SS.mmm. */
  readonly formatted: string;
  readonly bytesPerSecond: number;
  readonly headerBytes: number;
}

/** The other direction: how much recording time fits in a stated amount of space. */
export function pcmDuration(input: PcmDurationInput): ProResult<PcmDurationResult> {
  const rates = pcmRates(input);
  if (!rates.ok) return rates;
  if (!isPositive(input.bytes)) return fail("bytes");
  const payload = input.bytes - rates.headerBytes;
  // Space that does not even hold the headers holds no audio; a negative
  // duration would be arithmetic pretending to be an answer.
  if (payload < 0) return fail("bytes");
  const seconds = payload / (rates.bytesPerSecond * rates.tracks);
  return {
    ok: true,
    seconds,
    formatted: formatDuration(seconds),
    bytesPerSecond: rates.bytesPerSecond,
    headerBytes: rates.headerBytes,
  };
}

export interface BufferLatencyInput {
  /** Hz, 1000..768000. */
  readonly sampleRate: number;
  /** Samples, 1..65536. */
  readonly bufferSamples: number;
  /**
   * AD converter and driver input latency, ms, 0..100, read off the interface's
   * own data sheet. Separate from `extraOutMs` because manufacturers publish the
   * two halves separately and they are frequently not equal. No default: a
   * made-up number here silently becomes part of the user's round-trip figure.
   */
  readonly extraInMs?: number | undefined;
  /** DA converter and driver output latency, ms, 0..100. See `extraInMs`. */
  readonly extraOutMs?: number | undefined;
}

export interface BufferLatencyResult {
  /** The buffer alone, in ms — the theoretical minimum, with no converter term. */
  readonly oneWayMs: number;
  /** 2 × the buffer, with no converter term. Always present. */
  readonly bufferRoundTripMs: number;
  /** buffer + `extraInMs`; undefined without it, never assumed zero. */
  readonly oneWayInMs: number | undefined;
  /** buffer + `extraOutMs`; undefined without it, never assumed zero. */
  readonly oneWayOutMs: number | undefined;
  /** 2 × buffer + `extraInMs` + `extraOutMs`; undefined unless BOTH are typed. */
  readonly roundTripMs: number | undefined;
}

/**
 * What one buffer costs in latency, one way and round trip.
 *
 * **This is a theoretical minimum, not a measurement.** The buffer is traversed
 * once on the way in and once on the way out, so the round trip is twice it —
 * plus whatever the AD and DA converters add, which are two figures only the
 * data sheet knows and frequently disagree. A driver's own safety buffering and
 * the scheduling jitter of USB or Thunderbolt are outside this model entirely
 * and are never estimated here.
 */
export function bufferLatency(input: BufferLatencyInput): ProResult<BufferLatencyResult> {
  if (!isInRange(input.sampleRate, 1000, 768000)) return fail("sampleRate");
  if (!isIntegerIn(input.bufferSamples, 1, 65536)) return fail("bufferSamples");
  const { extraInMs, extraOutMs } = input;
  if (extraInMs !== undefined && !isInRange(extraInMs, 0, 100)) return fail("extraInMs");
  if (extraOutMs !== undefined && !isInRange(extraOutMs, 0, 100)) return fail("extraOutMs");
  const oneWayMs = (input.bufferSamples / input.sampleRate) * 1000;
  return {
    ok: true,
    oneWayMs,
    bufferRoundTripMs: 2 * oneWayMs,
    oneWayInMs: extraInMs === undefined ? undefined : oneWayMs + extraInMs,
    oneWayOutMs: extraOutMs === undefined ? undefined : oneWayMs + extraOutMs,
    roundTripMs:
      extraInMs === undefined || extraOutMs === undefined
        ? undefined
        : 2 * oneWayMs + extraInMs + extraOutMs,
  };
}

export interface SampleCountInput {
  readonly sampleRate: number;
  readonly milliseconds: number;
}

export interface SampleCountResult {
  /** Fractional when the duration does not land on a sample boundary — never rounded. */
  readonly samples: number;
  /** True when the count is exact; 1 ms at 44100 Hz is 44.1 samples and is not. */
  readonly wholeSamples: boolean;
}

/**
 * How many samples a duration is at a sample rate.
 *
 * A fractional count is shown as a fraction: 1 ms at 44.1 kHz is 44.1 samples,
 * and rounding it to 44 hides the fact that the requested duration does not land
 * on a sample boundary at all — which is exactly what the user is checking.
 */
export function sampleCount(input: SampleCountInput): ProResult<SampleCountResult> {
  if (!isInRange(input.sampleRate, 1000, 768000)) return fail("sampleRate");
  if (!isPositive(input.milliseconds)) return fail("milliseconds");
  const samples = (input.milliseconds / 1000) * input.sampleRate;
  return { ok: true, samples, wholeSamples: Number.isInteger(samples) };
}

export interface SampleDurationInput {
  readonly sampleRate: number;
  /** May be fractional; a count of zero is a real answer and not an empty field. */
  readonly samples: number;
}

export interface SampleDurationResult {
  readonly milliseconds: number;
}

/** How long a number of samples lasts at a sample rate. */
export function sampleDuration(input: SampleDurationInput): ProResult<SampleDurationResult> {
  if (!isInRange(input.sampleRate, 1000, 768000)) return fail("sampleRate");
  if (!isNonNegative(input.samples)) return fail("samples");
  return { ok: true, milliseconds: (input.samples / input.sampleRate) * 1000 };
}

export type VarispeedEntry =
  | { readonly kind: "semitones"; readonly value: number }
  | { readonly kind: "cents"; readonly value: number }
  | { readonly kind: "ratio"; readonly value: number }
  /**
   * Unambiguous by construction: material RECORDED at `recordedAtHz` and PLAYED
   * BACK at `playedBackAtHz` runs faster by `playedBackAtHz / recordedAtHz`. The
   * more common studio accident — a 48 kHz file dropped into a 44.1 kHz session —
   * is the reciprocal reading, and naming the two fields by what actually
   * happened to the file is what keeps that from being typed backwards.
   */
  | { readonly kind: "sampleRates"; readonly recordedAtHz: number; readonly playedBackAtHz: number };

export interface VarispeedInput {
  readonly entry: VarispeedEntry;
  /** BPM, 1..999; only with it is a resulting tempo reported. */
  readonly tempo?: number | undefined;
  /** Seconds; only with it is a resulting length reported. */
  readonly lengthSeconds?: number | undefined;
}

export interface VarispeedResult {
  readonly ratio: number;
  readonly semitones: number;
  readonly cents: number;
  readonly tempo: number | undefined;
  readonly lengthSeconds: number | undefined;
  readonly lengthFormatted: string | undefined;
}

/**
 * Resampling: pitch, speed, tempo and length all move together.
 *
 * The speed ratio is the single quantity and every entry point produces it —
 * semitones, cents, a ratio, or a pair of sample rates. Material written at
 * 44100 and played back as if it were 48000 runs faster by 48000/44100, which is
 * +146.71 cents; the inverse pair gives exactly -146.71, and that agreement is
 * the check that the two entry points are the same arithmetic.
 *
 * **This is not time-stretching.** A user who wanted the tempo changed without
 * the pitch is asking a different question, and reading this number as an answer
 * to it is the mistake the surface names in words.
 */
export function varispeed(input: VarispeedInput): ProResult<VarispeedResult> {
  const { entry } = input;
  let ratio: number;
  if (entry.kind === "semitones") {
    if (!isInRange(entry.value, -48, 48)) return fail("semitones");
    ratio = 2 ** (entry.value / 12);
  } else if (entry.kind === "cents") {
    if (!isInRange(entry.value, -12000, 12000)) return fail("cents");
    ratio = 2 ** (entry.value / CENTS_PER_OCTAVE);
  } else if (entry.kind === "ratio") {
    if (!isPositive(entry.value)) return fail("ratio");
    ratio = entry.value;
  } else {
    if (!isInRange(entry.recordedAtHz, 1000, 768000)) return fail("recordedAtHz");
    if (!isInRange(entry.playedBackAtHz, 1000, 768000)) return fail("playedBackAtHz");
    ratio = entry.playedBackAtHz / entry.recordedAtHz;
  }

  const { tempo, lengthSeconds } = input;
  if (tempo !== undefined && !isInRange(tempo, 1, 999)) return fail("tempo");
  if (lengthSeconds !== undefined && !isPositive(lengthSeconds)) return fail("lengthSeconds");
  const newLength = lengthSeconds === undefined ? undefined : lengthSeconds / ratio;
  return {
    ok: true,
    ratio,
    semitones: 12 * Math.log2(ratio),
    cents: CENTS_PER_OCTAVE * Math.log2(ratio),
    tempo: tempo === undefined ? undefined : tempo * ratio,
    lengthSeconds: newLength,
    lengthFormatted: newLength === undefined ? undefined : formatDuration(newLength),
  };
}

// --- Spelling: scales, chords and transposition -----------------------------

export type ScaleType =
  | "major"
  | "natural-minor"
  | "harmonic-minor"
  | "melodic-minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "major-pentatonic"
  | "minor-pentatonic"
  | "blues";

export type ChordType =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4"
  | "6"
  | "m6"
  | "7"
  | "maj7"
  | "m7"
  | "m7b5"
  | "dim7"
  | "9"
  | "m9"
  | "maj9"
  | "11"
  | "13";

interface Pattern {
  /** Semitone offsets from the root, as written — 14 for a ninth, not 2. */
  readonly semitones: readonly number[];
  /** How many LETTERS up from the root letter each degree is spelled on. */
  readonly letterSteps: readonly number[];
}

/**
 * The scale patterns, as PAIRS of parallel arrays.
 *
 * The letter steps are a separate array and not the degree index, because the
 * blues scale spells its b5 and its 5 on the same letter (C blues is
 * C Eb F Gb G Bb) and the pentatonics skip letters. An implementation that
 * assumes letterStep == degree index gets exactly those three scales wrong and
 * every other one right, which is why it survives review.
 */
const SCALE_PATTERNS: Record<ScaleType, Pattern> = {
  major: { semitones: [0, 2, 4, 5, 7, 9, 11], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  "natural-minor": { semitones: [0, 2, 3, 5, 7, 8, 10], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  "harmonic-minor": { semitones: [0, 2, 3, 5, 7, 8, 11], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  "melodic-minor": { semitones: [0, 2, 3, 5, 7, 9, 11], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  dorian: { semitones: [0, 2, 3, 5, 7, 9, 10], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  phrygian: { semitones: [0, 1, 3, 5, 7, 8, 10], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  lydian: { semitones: [0, 2, 4, 6, 7, 9, 11], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  mixolydian: { semitones: [0, 2, 4, 5, 7, 9, 10], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  locrian: { semitones: [0, 1, 3, 5, 6, 8, 10], letterSteps: [0, 1, 2, 3, 4, 5, 6] },
  "major-pentatonic": { semitones: [0, 2, 4, 7, 9], letterSteps: [0, 1, 2, 4, 5] },
  "minor-pentatonic": { semitones: [0, 3, 5, 7, 10], letterSteps: [0, 2, 3, 4, 6] },
  blues: { semitones: [0, 3, 5, 6, 7, 10], letterSteps: [0, 2, 3, 4, 4, 6] },
};

/** The chord patterns. An extension's letter step is taken mod 7; its octave is not spelled. */
const CHORD_PATTERNS: Record<ChordType, Pattern> = {
  maj: { semitones: [0, 4, 7], letterSteps: [0, 2, 4] },
  min: { semitones: [0, 3, 7], letterSteps: [0, 2, 4] },
  dim: { semitones: [0, 3, 6], letterSteps: [0, 2, 4] },
  aug: { semitones: [0, 4, 8], letterSteps: [0, 2, 4] },
  sus2: { semitones: [0, 2, 7], letterSteps: [0, 1, 4] },
  sus4: { semitones: [0, 5, 7], letterSteps: [0, 3, 4] },
  "6": { semitones: [0, 4, 7, 9], letterSteps: [0, 2, 4, 5] },
  m6: { semitones: [0, 3, 7, 9], letterSteps: [0, 2, 4, 5] },
  "7": { semitones: [0, 4, 7, 10], letterSteps: [0, 2, 4, 6] },
  maj7: { semitones: [0, 4, 7, 11], letterSteps: [0, 2, 4, 6] },
  m7: { semitones: [0, 3, 7, 10], letterSteps: [0, 2, 4, 6] },
  m7b5: { semitones: [0, 3, 6, 10], letterSteps: [0, 2, 4, 6] },
  dim7: { semitones: [0, 3, 6, 9], letterSteps: [0, 2, 4, 6] },
  "9": { semitones: [0, 4, 7, 10, 14], letterSteps: [0, 2, 4, 6, 1] },
  m9: { semitones: [0, 3, 7, 10, 14], letterSteps: [0, 2, 4, 6, 1] },
  maj9: { semitones: [0, 4, 7, 11, 14], letterSteps: [0, 2, 4, 6, 1] },
  "11": { semitones: [0, 4, 7, 10, 14, 17], letterSteps: [0, 2, 4, 6, 1, 3] },
  "13": { semitones: [0, 4, 7, 10, 14, 17, 21], letterSteps: [0, 2, 4, 6, 1, 3, 5] },
};

export interface KeySignature {
  readonly sharps: number;
  readonly flats: number;
  /**
   * Both kinds appear, so NO key signature corresponds to this scale — harmonic
   * and melodic minor always land here. The surface prints the accidental list
   * instead of inventing a signature that does not exist.
   */
  readonly mixed: boolean;
}

export type TriadQuality = "major" | "minor" | "diminished" | "augmented";

export interface DiatonicTriad {
  /** 1-based degree of the scale the triad is built on. */
  readonly degree: number;
  readonly notes: readonly (string | undefined)[];
  /** undefined when the two gaps are none of the four named qualities. */
  readonly quality: TriadQuality | undefined;
  /** The two stacked gaps in semitones, always reported — they are the evidence. */
  readonly gaps: readonly [number, number];
}

export interface SpellScaleInput {
  /** Root with accidental: `C`, `F#`, `Eb`, `Bbb`. No octave. */
  readonly root: string;
  readonly scale: ScaleType;
}

export interface SpelledScale {
  readonly notes: readonly SpelledNote[];
  /**
   * Seven-note scales only; a pentatonic has no key signature to report.
   * `undefined` also when a degree needs more than a double accidental — the
   * printed count would then describe a key that cannot be written at all. For
   * `harmonic-minor` and `melodic-minor` this is the RELATIVE NATURAL MINOR's
   * signature, not this scale's own spelled accidentals — see
   * `keySignatureIsRelative`.
   */
  readonly keySignature: KeySignature | undefined;
  /**
   * True for `harmonic-minor`, `melodic-minor`, and the five modes (`dorian`
   * through `locrian`) — none of the seven prints a signature of its own.
   * Harmonic and melodic minor borrow the relative natural minor's and write
   * the raised degree(s) as accidentals every time; counting either scale's own
   * spelled accidentals instead would print, e.g., „1 sharp" for A harmonic
   * minor, which is not a key signature anyone uses — it is the raised 7th
   * mistaken for one. A mode is a ROTATION of the major scale on the same
   * letters, so its own spelled accidentals are numerically identical to its
   * parent major's signature (D dorian's 0/0 IS C major's) — the number needs
   * no correction, but what is printed is the parent key's signature, not one
   * the mode owns, which is what this flag says.
   */
  readonly keySignatureIsRelative: boolean;
  /** Seven-note scales only. */
  readonly triads: readonly DiatonicTriad[] | undefined;
}

function spellPattern(root: LetterAccidental, pattern: Pattern): SpelledNote[] {
  const rootPc = mod12(naturalPc(root.letterIndex) + root.accidental);
  return pattern.semitones.map((semitones, index) => {
    const step = pattern.letterSteps[index] ?? 0;
    return spellNote(root.letterIndex + step, mod12(rootPc + semitones), semitones);
  });
}

function keySignatureOf(notes: readonly SpelledNote[]): KeySignature {
  let sharps = 0;
  let flats = 0;
  for (const note of notes) {
    if (note.accidental > 0) sharps += note.accidental;
    if (note.accidental < 0) flats -= note.accidental;
  }
  return { sharps, flats, mixed: sharps > 0 && flats > 0 };
}

function triadsOf(notes: readonly SpelledNote[]): DiatonicTriad[] {
  return notes.map((_, index) => {
    const members = [index, (index + 2) % 7, (index + 4) % 7].map((i) => notes[i]);
    const [first, third, fifth] = members;
    const g1 = mod12((third?.pitchClass ?? 0) - (first?.pitchClass ?? 0));
    const g2 = mod12((fifth?.pitchClass ?? 0) - (third?.pitchClass ?? 0));
    let quality: TriadQuality | undefined;
    if (g1 === 4 && g2 === 3) quality = "major";
    else if (g1 === 3 && g2 === 4) quality = "minor";
    else if (g1 === 3 && g2 === 3) quality = "diminished";
    else if (g1 === 4 && g2 === 4) quality = "augmented";
    return {
      degree: index + 1,
      notes: members.map((note) => note?.name),
      quality,
      gaps: [g1, g2] as const,
    };
  });
}

/**
 * Spells a scale by LETTER order, with its key signature and its diatonic triads.
 *
 * **The letter, not the pitch class, chooses the name.** Eb natural minor's sixth
 * degree is pitch class 11 spelled on the letter C, which makes it Cb and not B —
 * that is what gives the scale its six flats and what a pitch-class-only
 * implementation cannot produce. A degree needing a triple accidental is reported
 * as unspellable rather than renamed, because renaming it would silently change
 * the key.
 */
export function spellScale(input: SpellScaleInput): ProResult<SpelledScale> {
  const root = parseLetterAccidental(input.root.trim());
  if (root === undefined) return fail("root");
  if (!isKeyOf(input.scale, SCALE_PATTERNS)) return fail("scale");
  const notes = spellPattern(root, SCALE_PATTERNS[input.scale]);
  const heptatonic = notes.length === 7;
  const borrowsRelativeMinor = input.scale === "harmonic-minor" || input.scale === "melodic-minor";
  const keySignatureIsRelative =
    borrowsRelativeMinor ||
    input.scale === "dorian" ||
    input.scale === "phrygian" ||
    input.scale === "lydian" ||
    input.scale === "mixolydian" ||
    input.scale === "locrian";
  const signatureNotes = borrowsRelativeMinor
    ? spellPattern(root, SCALE_PATTERNS["natural-minor"])
    : notes;
  // A degree the scale itself cannot spell makes the printed count a count of
  // a key that cannot be written — withheld rather than shown, exactly as
  // `transposeKey` already guards its own signature output.
  const spellable = signatureNotes.every((note) => note.name !== undefined);
  return {
    ok: true,
    notes,
    keySignature: heptatonic && spellable ? keySignatureOf(signatureNotes) : undefined,
    keySignatureIsRelative: heptatonic && keySignatureIsRelative,
    triads: heptatonic ? triadsOf(notes) : undefined,
  };
}

export interface SpellChordInput {
  readonly root: string;
  readonly chord: ChordType;
}

export interface SpelledChord {
  readonly notes: readonly SpelledNote[];
}

/**
 * Spells a chord by letter order.
 *
 * C7 is C E G Bb and never C E G A#: the seventh is spelled on the letter B
 * because the pattern's letter step says so, and the pitch class only decides
 * which accidental that letter carries.
 */
export function spellChord(input: SpellChordInput): ProResult<SpelledChord> {
  const root = parseLetterAccidental(input.root.trim());
  if (root === undefined) return fail("root");
  if (!isKeyOf(input.chord, CHORD_PATTERNS)) return fail("chord");
  return { ok: true, notes: spellPattern(root, CHORD_PATTERNS[input.chord]) };
}

export type IntervalName =
  | "unison"
  | "minor-second"
  | "major-second"
  | "minor-third"
  | "major-third"
  | "perfect-fourth"
  | "augmented-fourth"
  | "diminished-fifth"
  | "perfect-fifth"
  | "minor-sixth"
  | "major-sixth"
  | "minor-seventh"
  | "major-seventh"
  | "octave";

interface IntervalSize {
  /** How many LETTERS the interval moves — 4 for any kind of fifth. */
  readonly letterStep: number;
  readonly semitones: number;
}

/**
 * An interval is a PAIR: how many letters it moves and how many semitones.
 *
 * The tritone is offered twice because A4 and d5 sound alike and spell
 * differently — Eb up an A4 is A, up a d5 is Bbb — and only the user knows which
 * one the music means.
 */
const INTERVALS: Record<IntervalName, IntervalSize> = {
  unison: { letterStep: 0, semitones: 0 },
  "minor-second": { letterStep: 1, semitones: 1 },
  "major-second": { letterStep: 1, semitones: 2 },
  "minor-third": { letterStep: 2, semitones: 3 },
  "major-third": { letterStep: 2, semitones: 4 },
  "perfect-fourth": { letterStep: 3, semitones: 5 },
  "augmented-fourth": { letterStep: 3, semitones: 6 },
  "diminished-fifth": { letterStep: 4, semitones: 6 },
  "perfect-fifth": { letterStep: 4, semitones: 7 },
  "minor-sixth": { letterStep: 5, semitones: 8 },
  "major-sixth": { letterStep: 5, semitones: 9 },
  "minor-seventh": { letterStep: 6, semitones: 10 },
  "major-seventh": { letterStep: 6, semitones: 11 },
  octave: { letterStep: 0, semitones: 12 },
};

/**
 * The interval each instrument's name states, and which WAY written pitch moves
 * relative to concert pitch.
 *
 * **„Written sounds lower" is not a universal rule.** It holds for the ordinary
 * Bb, A and F instruments and for the common Eb alto/baritone family, but the Eb
 * sopranino clarinet and the Eb soprano cornet sound a minor third HIGHER than
 * written — the same pitch class as „a major sixth lower" but a full octave in
 * the other direction, which is exactly the kind of error that hides inside a
 * pitch-class-only transposer and only shows up an octave off. No octave is
 * inferred from an instrument name either way; that is the explicit
 * `octaveShift` input's business.
 */
export type TransposingInstrument = "bb" | "a" | "eb-alto" | "eb-sopranino" | "f";

interface InstrumentTransposition {
  readonly interval: IntervalName;
  /** True when WRITTEN pitch sounds lower than concert; false for the sopranino Eb exception. */
  readonly writtenSoundsLower: boolean;
}

const INSTRUMENT_TRANSPOSITION: Record<TransposingInstrument, InstrumentTransposition> = {
  bb: { interval: "major-second", writtenSoundsLower: true },
  a: { interval: "minor-third", writtenSoundsLower: true },
  "eb-alto": { interval: "major-sixth", writtenSoundsLower: true },
  "eb-sopranino": { interval: "minor-third", writtenSoundsLower: false },
  f: { interval: "perfect-fifth", writtenSoundsLower: true },
};

export type TransposeBy =
  | {
      readonly kind: "interval";
      readonly interval: IntervalName;
      readonly direction: "up" | "down";
    }
  | {
      readonly kind: "instrument";
      readonly instrument: TransposingInstrument;
      readonly direction: "written-to-sounding" | "sounding-to-written";
    };

interface ResolvedTransposition {
  readonly letterStep: number;
  readonly semitones: number;
  readonly up: boolean;
}

/**
 * Validates a `TransposeBy` before `resolveTransposition` ever indexes
 * `INTERVALS` or `INSTRUMENT_TRANSPOSITION` with it, or reads its `direction`.
 *
 * Without this, an unrecognised `interval` or `instrument` does not answer
 * wrongly: `INTERVALS[by.interval]` / `INSTRUMENT_TRANSPOSITION[by.instrument]`
 * come back `undefined`, and `resolveTransposition` either spreads that into
 * `NaN` letterStep/semitones (silently reporting every token unspellable) or
 * destructures it and throws — a crash inside a main-process IPC handler
 * instead of the refusal every other bad input in this file gets. An
 * unrecognised `direction` is the same defect in a smaller shape: `up: by
 * .direction === "up"` silently treats anything but the literal string "up"
 * as "down", transposing the opposite way from the one asked for.
 */
function transposeByFailure(by: TransposeBy): string | undefined {
  if (by.kind === "interval") {
    if (!isKeyOf(by.interval, INTERVALS)) return "interval";
    if (!isOneOf(by.direction, ["up", "down"] as const)) return "direction";
    return undefined;
  }
  if (!isKeyOf(by.instrument, INSTRUMENT_TRANSPOSITION)) return "instrument";
  if (!isOneOf(by.direction, ["written-to-sounding", "sounding-to-written"] as const)) {
    return "direction";
  }
  return undefined;
}

function resolveTransposition(by: TransposeBy): ResolvedTransposition {
  if (by.kind === "interval") {
    const interval = INTERVALS[by.interval];
    return { ...interval, up: by.direction === "up" };
  }
  // A Bb trumpet's written D sounds C: written-to-sounding goes DOWN a major
  // second, because Bb `writtenSoundsLower`. An Eb sopranino's written D sounds
  // F: written-to-sounding goes UP a minor third, because it does not.
  const { interval: intervalName, writtenSoundsLower } = INSTRUMENT_TRANSPOSITION[by.instrument];
  const interval = INTERVALS[intervalName];
  const soundingGoesUp = !writtenSoundsLower;
  const up = by.direction === "written-to-sounding" ? soundingGoesUp : !soundingGoesUp;
  return { ...interval, up };
}

function transposeSpelling(
  letterIndex: number,
  pitchClass: number,
  by: ResolvedTransposition,
): SpelledNote {
  const newLetter = by.up ? letterIndex + by.letterStep : letterIndex - by.letterStep;
  const newPc = mod12(by.up ? pitchClass + by.semitones : pitchClass - by.semitones);
  return spellNote(newLetter, newPc, by.semitones);
}

/** Chord-quality words a suffix may be built from; anything else is not a chord symbol. */
const CHORD_QUALITY_WORDS = new Set([
  "m",
  "min",
  "M",
  "maj",
  "Maj",
  "dim",
  "Dim",
  "aug",
  "Aug",
  "sus",
  "add",
  "alt",
  "dom",
  "b",
  "no",
  "omit",
]);

/**
 * Whether a suffix reads as a chord quality rather than as the rest of a word.
 *
 * Every alphabetic RUN in it has to be a quality word, which is what keeps
 * „Bad", „Face" and „Age" out of the transposition while letting `m7b5`,
 * `maj7#11`, `7sus4` and `6/9` through. Without that test a lyric sheet comes
 * back mangled, and the promise that non-music text passes through untouched is
 * the one a chart transposer is actually judged on.
 */
function isChordSuffix(suffix: string): boolean {
  if (suffix === "") return true;
  if (!/^[A-Za-z0-9#b+\-()/°øΔ^]*$/.test(suffix)) return false;
  return suffix
    .split(/[^A-Za-z]+/)
    .filter((run) => run !== "")
    .every((run) => CHORD_QUALITY_WORDS.has(run));
}

const CHORD_TOKEN = /^([A-G])(#{1,2}|b{1,2}|x)?(.*?)(?:\/([A-G])(#{1,2}|b{1,2}|x)?)?$/;

export interface TransposedSegment {
  /** Exactly the characters of the input this segment covers. */
  readonly source: string;
  /** The transposed spelling; undefined when the token is not music, or unspellable. */
  readonly transposed: string | undefined;
  /** True when the segment was recognised as a note or chord symbol. */
  readonly music: boolean;
}

export interface TransposeTextInput {
  /** 1..5000 characters. Line breaks, runs of spaces and `|` bar lines are preserved. */
  readonly text: string;
  readonly by: TransposeBy;
}

export interface TransposedText {
  readonly segments: readonly TransposedSegment[];
  /** Segments joined back with the layout intact; an unspellable token keeps its source. */
  readonly text: string;
  /** How many recognised tokens would need more than a double accidental. */
  readonly unspellable: number;
}

function transposeRoot(
  letter: string,
  accidental: string | undefined,
  by: ResolvedTransposition,
): SpelledNote {
  const letterIndex = LETTERS.indexOf(letter);
  const offset = accidentalValue(accidental);
  return transposeSpelling(letterIndex, mod12(naturalPc(letterIndex) + offset), by);
}

/**
 * Transposes a chord chart, keeping every line break, space run and bar line.
 *
 * **Only the root and the note after a slash move**; the quality suffix is copied
 * through character for character, because `sus4` and `#11` are names of
 * intervals above the root and not pitches. Anything that is not a chord symbol
 * passes through untouched.
 *
 * **A trailing digit is read as a chord extension, not as an octave.** `C7` is a
 * dominant seventh in every chart ever written, and scientific pitch notation is
 * the other entry point — `transposePitch` — precisely because the two notations
 * collide on that character and no guess can be right for both.
 */
export function transposeText(input: TransposeTextInput): ProResult<TransposedText> {
  if (input.text.length < 1 || input.text.length > 5000) return fail("text");
  const byFailure = transposeByFailure(input.by);
  if (byFailure !== undefined) return fail(byFailure);
  const by = resolveTransposition(input.by);
  const parts = input.text.split(/(\s+|\|)/).filter((part) => part !== "");

  let unspellable = 0;
  const segments = parts.map((part): TransposedSegment => {
    const match = CHORD_TOKEN.exec(part);
    const letter = match?.[1];
    const suffix = match?.[3] ?? "";
    if (match === null || letter === undefined || !isChordSuffix(suffix)) {
      return { source: part, transposed: undefined, music: false };
    }
    const root = transposeRoot(letter, match[2], by);
    const bassLetter = match[4];
    const bass = bassLetter === undefined ? undefined : transposeRoot(bassLetter, match[5], by);
    if (root.name === undefined || (bass !== undefined && bass.name === undefined)) {
      unspellable += 1;
      return { source: part, transposed: undefined, music: true };
    }
    const tail = bass === undefined ? "" : `/${bass.name ?? ""}`;
    return { source: part, transposed: `${root.name}${suffix}${tail}`, music: true };
  });

  return {
    ok: true,
    segments,
    text: segments.map((segment) => segment.transposed ?? segment.source).join(""),
    unspellable,
  };
}

export interface TransposePitchInput {
  /** Scientific pitch notation with an octave: `C4`, `Bb-1`, `F##3`. */
  readonly name: string;
  readonly by: TransposeBy;
  /** Whole octaves, -3..+3. Default 0 — how a bass clarinet's extra octave is stated. */
  readonly octaveShift?: number | undefined;
}

export interface TransposedPitch {
  /** undefined when the result would need more than a double accidental. */
  readonly name: string | undefined;
  readonly letter: string;
  readonly accidental: number;
  readonly octave: number;
  /** Absolute MIDI number of the result, including the octave shift. */
  readonly midi: number;
}

/**
 * Transposes one written pitch, octave and all.
 *
 * The octave is derived from the SPELLED letter and the absolute number, not
 * from the pitch class: Cb4 is 59 and stays written in octave 4 even though it
 * sounds as B3, and B#3 is 60 and stays in octave 3. Deriving the octave from
 * `floor(midi/12)` instead moves both of them across the bar of the octave
 * boundary and is the defect that only ever shows up on those two spellings.
 */
export function transposePitch(input: TransposePitchInput): ProResult<TransposedPitch> {
  const octaveShift = input.octaveShift ?? 0;
  if (!isIntegerIn(octaveShift, -3, 3)) return fail("octaveShift");
  const match = /^([A-Ga-g](?:#{1,2}|b{1,2}|x)?)(-?\d)$/.exec(input.name.trim());
  const head = match === null ? undefined : parseLetterAccidental(match[1] ?? "");
  const octave = Number(match?.[2]);
  if (head === undefined || !isIntegerIn(octave, -1, 9)) return fail("name");

  const byFailure = transposeByFailure(input.by);
  if (byFailure !== undefined) return fail(byFailure);
  const by = resolveTransposition(input.by);
  const pitchClass = mod12(naturalPc(head.letterIndex) + head.accidental);
  const spelled = transposeSpelling(head.letterIndex, pitchClass, by);
  const sourceMidi = (octave + 1) * 12 + naturalPc(head.letterIndex) + head.accidental;
  const midi = sourceMidi + (by.up ? by.semitones : -by.semitones) + 12 * octaveShift;
  // The octave that makes (octave + 1)*12 + natural + accidental come back to
  // this absolute number — an integer by construction, since the spelled letter
  // and accidental already agree with it modulo 12.
  const written = naturalPc(LETTERS.indexOf(spelled.letter)) + spelled.accidental;
  const newOctave = (midi - written) / 12 - 1;
  return {
    ok: true,
    name: spelled.name === undefined ? undefined : `${spelled.name}${newOctave}`,
    letter: spelled.letter,
    accidental: spelled.accidental,
    octave: newOctave,
    midi,
  };
}

/**
 * For a black-key pitch class, the two ordinary single-accidental spellings —
 * the only real choice a sharps/flats preference has to make. A white-key pitch
 * class has one natural spelling and no such choice, so it is not in this table.
 * Letter indices: C0 D1 E2 F3 G4 A5 B6.
 */
const ENHARMONIC_PAIRS: Partial<Record<number, { readonly sharp: number; readonly flat: number }>> = {
  1: { sharp: 0, flat: 1 }, // C# / Db
  3: { sharp: 1, flat: 2 }, // D# / Eb
  6: { sharp: 3, flat: 4 }, // F# / Gb
  8: { sharp: 4, flat: 5 }, // G# / Ab
  10: { sharp: 5, flat: 6 }, // A# / Bb
};

export interface TransposeKeyInput {
  /** Tonic with accidental: `Eb`, `F#`. */
  readonly tonic: string;
  readonly mode: "major" | "minor";
  readonly by: TransposeBy;
  /**
   * How to spell a resulting tonic that has two equally valid names — F# major
   * and Gb major both carry six accidentals, and nothing about the arithmetic
   * prefers one. `source` (the default) keeps whichever letter the deterministic
   * transposition arithmetic lands on; `sharps`/`flats` override it ONLY when an
   * alternate single-accidental spelling on the neighbouring letter exists.
   */
  readonly enharmonicPreference?: "source" | "sharps" | "flats" | undefined;
}

export interface TransposedKey {
  /** undefined when the resulting tonic needs more than a double accidental. */
  readonly tonic: string | undefined;
  /** The signature of the resulting key; undefined when any degree is unspellable. */
  readonly signature: KeySignature | undefined;
}

/**
 * The key a transposed part lands in, and how many accidentals that key carries.
 *
 * The count comes from spelling the scale itself rather than from a circle-of-
 * fifths table, so the two can never disagree: Eb minor spells Eb F Gb Ab Bb Cb
 * Db and therefore has six flats, which is exactly the count of accidentals in
 * the spelling.
 */
export function transposeKey(input: TransposeKeyInput): ProResult<TransposedKey> {
  const root = parseLetterAccidental(input.tonic.trim());
  if (root === undefined) return fail("tonic");
  if (!isOneOf(input.mode, ["major", "minor"] as const)) return fail("mode");
  const preference = input.enharmonicPreference ?? "source";
  if (!isOneOf(preference, ["source", "sharps", "flats"] as const)) {
    return fail("enharmonicPreference");
  }
  const byFailure = transposeByFailure(input.by);
  if (byFailure !== undefined) return fail(byFailure);
  const by = resolveTransposition(input.by);
  const pitchClass = mod12(naturalPc(root.letterIndex) + root.accidental);
  let tonic = transposeSpelling(root.letterIndex, pitchClass, by);

  if (preference !== "source") {
    const pair = ENHARMONIC_PAIRS[tonic.pitchClass];
    if (pair !== undefined) {
      const letterIndex = preference === "sharps" ? pair.sharp : pair.flat;
      tonic = spellNote(letterIndex, tonic.pitchClass, tonic.semitones);
    }
  }
  if (tonic.name === undefined) return { ok: true, tonic: undefined, signature: undefined };

  const scale = spellScale({
    root: tonic.name,
    scale: input.mode === "major" ? "major" : "natural-minor",
  });
  if (!scale.ok) return scale;
  const spellable = scale.notes.every((note) => note.name !== undefined);
  return {
    ok: true,
    tonic: tonic.name,
    signature: spellable ? scale.keySignature : undefined,
  };
}
