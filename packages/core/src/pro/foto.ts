/**
 * „Fotografija i video" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, the rule `pro/gradnja.ts` states: a
 * tool several packs share lives in the file of its FIRST pack in `TOOL_PACKS`
 * order, so nobody has to relitigate ownership per tool.
 *
 * **Every model in here is a model, and the surface says so.** Depth of field is
 * thin-lens with distances from the front principal plane; angle of view assumes
 * a rectilinear projection focused at infinity; the Airy disc is the far-field,
 * circular, unaberrated case. None of those are corrected silently — a tool that
 * quietly „fixes" close focus produces a number nobody can reproduce by hand,
 * which is the opposite of what a calculator is for.
 *
 * **The tool never picks a convention for the user.** The circle of confusion,
 * the meter's calibration constant C, the guide number printed on the flash and
 * the wavelength being examined are all typed in. Every one of them is a number
 * somebody else measured or chose, and defaulting one is this app asserting a
 * convention it cannot know applies. Where the catalogue lists a `regulated`
 * constant (C, from ISO 2720's permitted RANGE rather than a fixed value), it is
 * an input with no default at all.
 *
 * **Nothing here is rounded to a marketing figure or snapped to an engraved
 * scale.** A Four Thirds sensor is crop 1.9994, an f-stop lands where the
 * arithmetic puts it and a solved shutter is 1/6693.44 s. The one place a value
 * is rounded on purpose is `motionBlurShutter`, which rounds the denominator UP
 * because a shorter exposure can never allow more blur than was asked for.
 */

import {
  fail,
  floorSnapped,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  ratioAgainst,
  type ProResult,
} from "./result.js";

/* -------------------------------------------------------------- shared kit -- */

/** 180/pi = 57.29577951308232. Pure mathematics. */
const DEG_PER_RAD = 180 / Math.PI;

/** SI prefix definition: 1 m = 10^3 mm. */
const MM_PER_M = 1000;

/** 1 um = 10^-3 mm. */
const UM_PER_MM = 1000;

/** 1 km/h = 1000/3600 m/s = 0.2777777777777778. */
const MS_PER_KMH = 1000 / 3600;

/** log10(2) = 0.3010299956639812 — density is base 10, a stop is base 2. */
const LOG10_2 = Math.log10(2);

/** Definitional arithmetic: 1 B = 8 bit. */
const BITS_PER_BYTE = 8;

/** Powers of ten and of two; the binary prefix NAMES are IEC 80000-13:2008. */
const BYTES_PER_MB = 1e6;
const BYTES_PER_GB = 1e9;
const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 * 1024 * 1024;

/**
 * Sensor diagonal in mm, from width and height in mm — Pythagoras, and nothing
 * else. Written once and adopted by every tool that needs it (the 135 constant
 * just below, `angleOfView`, `cropFactor`) so the copies the review found across
 * five surfaces cannot drift apart from each other by so much as an ulp.
 */
function sensorDiagonalMm(width: number, height: number): number {
  return Math.sqrt(width * width + height * height);
}

/**
 * Pixel pitch in mm: sensor width divided by the horizontal pixel count across
 * it. Shared by `diffractionLimit` (which converts the result to micrometres at
 * its own call site) and `resolveMotionGeometry` (which keeps it in mm), so the
 * one division lives in one place regardless of which unit a caller wants next.
 */
function pixelPitchMm(sensorWidth: number, pixelCount: number): number {
  return sensorWidth / pixelCount;
}

/**
 * ISO 1007:2000, Photography — 135-size film and magazine: the image area is
 * 36 x 24 mm. That pair IS the definition of the reference format — a different
 * pair would be a different format, not a revision of this one — so the diagonal
 * below is pure arithmetic from it and equals 43.266615305567875 mm.
 *
 * It is derived rather than typed so that a 36 x 24 sensor comes out at crop
 * 1.0000000 exactly: the same expression on both sides of the division cannot
 * disagree with itself by an ulp.
 */
export const FORMAT_135_WIDTH_MM = 36;
export const FORMAT_135_HEIGHT_MM = 24;
export const FORMAT_135_DIAGONAL_MM = sensorDiagonalMm(FORMAT_135_WIDTH_MM, FORMAT_135_HEIGHT_MM);

/**
 * First zero of the Bessel function J1: j11 = 3.8317059702. The Airy diameter
 * factor 2*j11/pi = 2.4393397825282266 is what the textbook prints as 2.44; the
 * unrounded value is used so the arithmetic is reproducible.
 */
const BESSEL_J1_FIRST_ZERO = 3.8317059702;
const AIRY_DIAMETER_FACTOR = (2 * BESSEL_J1_FIRST_ZERO) / Math.PI;

/**
 * The anchor of the EV scale and of the guide-number definition: both EV =
 * log2(N^2/t) and GN = N*d are stated at ISO 100. It is the definition of the
 * scale, not a figure an authority revises.
 */
const EV_REFERENCE_ISO = 100;

/**
 * International yard and pound agreement (1959): 1 ft = 0.3048 m exactly, hence
 * 1 ft^2 = 0.09290304 m^2 and 1 fc = 1/0.09290304 lx = 10.763910416709722 lx.
 * Both directions are exact by definition rather than measured, which is why the
 * lx -> fc -> lx round trip closes. The same 0.3048 also converts a guide number
 * printed in feet — a figure that unit systems disagree on far more often than
 * illuminance does.
 */
const METRES_PER_FOOT = 0.3048;
const SQUARE_METRES_PER_SQUARE_FOOT = METRES_PER_FOOT * METRES_PER_FOOT;
const LUX_PER_FOOT_CANDLE = 1 / SQUARE_METRES_PER_SQUARE_FOOT;

/** A length as the user's own instrument prints it — metres, or feet. */
export type LengthUnit = "m" | "ft";

/** Definition of the mired (micro reciprocal degree): M = 10^6/T, T in kelvin. */
const MIRED_SCALE = 1e6;

/**
 * SMPTE ST 170M-2004 and ST 12-1:2014: the NTSC-derived rates are the exact
 * rationals 24000/1001, 30000/1001 and 60000/1001, and the labels 23.976, 29.97
 * and 59.94 are how those rationals are written on a menu — not measurements
 * that happen to be close. A conform computed from 29.97 instead of 30000/1001
 * misses an hour by about 0.1 s, which is exactly the error the pull-down
 * arithmetic exists to expose.
 */
const NTSC_RATES: readonly { readonly labelled: number; readonly exact: number }[] = [
  { labelled: 23.976, exact: 24000 / 1001 },
  { labelled: 29.97, exact: 30000 / 1001 },
  { labelled: 59.94, exact: 60000 / 1001 },
];

/**
 * The exact rational a labelled NTSC-derived rate stands for, or the rate as
 * typed. Idempotent: feeding 30000/1001 back in returns it unchanged, because
 * the label and the rational are within the same 5e-4 window.
 */
export function exactFrameRate(fps: number): number {
  if (!Number.isFinite(fps)) return fps;
  for (const rate of NTSC_RATES) {
    if (Math.abs(fps - rate.labelled) < 5e-4) return rate.exact;
  }
  return fps;
}

/**
 * A shutter time typed either as seconds (`0.008`) or in the form every camera
 * engraves it (`1/125`).
 *
 * Written once and shared by four tools, because the parse is where the mistake
 * is: `Number("1/125")` is `NaN`, and a tool that reads the field with `Number`
 * alone refuses every shutter a photographer would actually type. A blank field
 * is a refusal, never zero.
 */
export function parseShutterTime(text: string): ProResult<{ readonly seconds: number }> {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  if (slash < 0) {
    const seconds = Number(trimmed);
    return trimmed.length > 0 && isPositive(seconds) ? { ok: true, seconds } : fail("shutter");
  }
  const numerator = Number(trimmed.slice(0, slash).trim());
  const denominator = Number(trimmed.slice(slash + 1).trim());
  if (!isPositive(numerator) || !isPositive(denominator)) return fail("shutter");
  return { ok: true, seconds: numerator / denominator };
}

/** How many of a set of mutually exclusive fields the user actually filled. */
function definedCount(...values: readonly (number | undefined)[]): number {
  return values.reduce<number>((count, value) => (value === undefined ? count : count + 1), 0);
}

/* ------------------------------------------------------------ angle of view -- */

export interface AngleOfViewInput {
  /** Sensor width, in mm — the real imaging area, not the format's name. */
  readonly sensorWidth: number;
  readonly sensorHeight: number;
  /** Focal length, in mm. */
  readonly focalLength: number;
  /** Subject distance, in metres. Absent means only the angles are computed. */
  readonly subjectDistance?: number | undefined;
}

export interface AngleOfView {
  /** Horizontal, vertical and diagonal angle of view, in degrees. */
  readonly horizontal: number;
  readonly vertical: number;
  readonly diagonal: number;
  /** Sensor diagonal, in mm. */
  readonly sensorDiagonal: number;
  /** Field covered at the subject distance, in metres — undefined when none was given. */
  readonly fieldWidth: number | undefined;
  readonly fieldHeight: number | undefined;
  readonly fieldDiagonal: number | undefined;
  /**
   * Always `true`: the field figures above assume the lens is focused at
   * infinity. `motionBlurPixels` computes the SAME geometry with the
   * finite-conjugate magnification f/(D-f), which is the more accurate model at
   * ordinary focus distances (the two disagree by about 7% at 0.5 m) — this flag
   * exists so a surface built on this result cannot forget to say which
   * assumption it is showing, rather than the disagreement living only in a
   * comment nobody reading the numbers ever sees.
   */
  readonly focusedAtInfinity: true;
}

/**
 * The angle a sensor of a given size sees through a given focal length, and how
 * much of the world that angle covers at a distance.
 *
 * **The covered field is computed as D*d/f, not as 2*D*tan(alpha/2).** They are
 * the same number — substituting alpha = 2*atan(d/2f) collapses one into the
 * other — but the first is one multiplication and cannot drift from the angle by
 * a rounding, while the second reconstructs a tangent from a value that has
 * already been through an arctangent.
 *
 * The model is rectilinear (gnomonic) projection focused at infinity. A fisheye
 * uses a different projection entirely, and at macro distances the true field is
 * LARGER than this: the surface states that rather than the tool guessing at a
 * bellows correction it has no data for. `motionBlurPixels` computes the same
 * geometry at finite conjugate (m = f/(D-f)) rather than at infinity, so the two
 * tools disagree on the covered field by design, not by accident — the result
 * carries `focusedAtInfinity: true` so that disagreement cannot go unmentioned
 * on whatever surface reads it.
 */
export function angleOfView(input: AngleOfViewInput): ProResult<AngleOfView> {
  const { sensorWidth, sensorHeight, focalLength } = input;
  if (!isInRange(sensorWidth, 0.5, 200)) return fail("sensorWidth");
  if (!isInRange(sensorHeight, 0.5, 200)) return fail("sensorHeight");
  if (!isInRange(focalLength, 0.5, 5000)) return fail("focalLength");
  const distance = input.subjectDistance;
  if (distance !== undefined && !isInRange(distance, 0.01, 100000)) return fail("subjectDistance");

  const sensorDiagonal = sensorDiagonalMm(sensorWidth, sensorHeight);
  const angle = (dimension: number): number =>
    2 * Math.atan(dimension / (2 * focalLength)) * DEG_PER_RAD;
  const field = (dimension: number): number | undefined =>
    distance === undefined ? undefined : (distance * dimension) / focalLength;

  return {
    ok: true,
    horizontal: angle(sensorWidth),
    vertical: angle(sensorHeight),
    diagonal: angle(sensorDiagonal),
    sensorDiagonal,
    fieldWidth: field(sensorWidth),
    fieldHeight: field(sensorHeight),
    fieldDiagonal: field(sensorDiagonal),
    focusedAtInfinity: true,
  };
}

/* -------------------------------------------------------------- crop factor -- */

export interface CropFactorInput {
  readonly sensorWidth: number;
  readonly sensorHeight: number;
  /** Focal length in mm, optional — only to convert it. */
  readonly focalLength?: number | undefined;
  /** f-number, optional and independent of the focal length. */
  readonly fNumber?: number | undefined;
}

export interface CropFactor {
  readonly cropFactor: number;
  readonly sensorDiagonal: number;
  readonly equivalentFocalLength: number | undefined;
  /**
   * The f-number that would give the same depth of field and the same total
   * light through the aperture on 135 — NOT the same exposure per unit area,
   * which does not change with format.
   */
  readonly equivalentAperture: number | undefined;
}

/**
 * The crop factor of a sensor against 135, and the 135-equivalent focal length
 * and aperture.
 *
 * **The computed number is what comes back, never the marketing one.** Four
 * Thirds at 17.3 x 13.0 mm is 1.9994, not 2; APS-C at 23.5 x 15.6 is 1.5339, not
 * „1.5". Rounding here would be the tool inventing a sensor size it was not
 * given, and the whole reason the width and height are typed in is that the
 * format's NAME is not a measurement.
 */
export function cropFactor(input: CropFactorInput): ProResult<CropFactor> {
  const { sensorWidth, sensorHeight } = input;
  if (!isInRange(sensorWidth, 0.5, 200)) return fail("sensorWidth");
  if (!isInRange(sensorHeight, 0.5, 200)) return fail("sensorHeight");
  const focalLength = input.focalLength;
  if (focalLength !== undefined && !isInRange(focalLength, 0.5, 5000)) return fail("focalLength");
  const fNumber = input.fNumber;
  if (fNumber !== undefined && !isInRange(fNumber, 0.5, 256)) return fail("fNumber");

  const sensorDiagonal = sensorDiagonalMm(sensorWidth, sensorHeight);
  const factor = FORMAT_135_DIAGONAL_MM / sensorDiagonal;
  return {
    ok: true,
    cropFactor: factor,
    sensorDiagonal,
    equivalentFocalLength: focalLength === undefined ? undefined : focalLength * factor,
    equivalentAperture: fNumber === undefined ? undefined : fNumber * factor,
  };
}

/* ---------------------------------------------------------- depth of field -- */

export interface DepthOfFieldInput {
  /** Focal length, in mm. */
  readonly focalLength: number;
  readonly fNumber: number;
  /** Focus distance, in metres, measured from the front principal plane. */
  readonly focusDistance: number;
  /**
   * Circle of confusion, in mm. There is deliberately no default: d/1500,
   * d/1730 and „0.030 for 135" are three different conventions that disagree by
   * a stop's worth of depth, and choosing between them is the photographer's.
   */
  readonly circleOfConfusion: number;
}

export interface DepthOfField {
  /** Hyperfocal distance, in metres. */
  readonly hyperfocal: number;
  readonly nearLimit: number;
  /** Far limit in metres, or undefined when it is at infinity. */
  readonly farLimit: number | undefined;
  readonly totalDepth: number | undefined;
  /** True when focus is at or beyond the hyperfocal — the arithmetic, not a judgement. */
  readonly farIsInfinite: boolean;
}

/**
 * Hyperfocal distance and the near and far limits of acceptable sharpness.
 *
 * **Focus at or beyond the hyperfocal has no far limit at all**, and the answer
 * says so with a flag rather than a very large number: `s/(H-s)` at s slightly
 * below H produces 10^9 metres, which a surface would happily print as if it
 * meant something. `farLimit` and `totalDepth` are undefined in that case, and
 * `farIsInfinite` distinguishes „infinite" from „not computed".
 *
 * Everything is computed in millimetres and converted once on the way out, so
 * the metre/millimetre boundary exists in exactly two places instead of six.
 */
export function depthOfField(input: DepthOfFieldInput): ProResult<DepthOfField> {
  const { focalLength, fNumber, circleOfConfusion } = input;
  if (!isInRange(focalLength, 1, 2000)) return fail("focalLength");
  if (!isInRange(fNumber, 0.5, 256)) return fail("fNumber");
  if (!isInRange(circleOfConfusion, 0.001, 0.2)) return fail("circleOfConfusion");
  if (!isInRange(input.focusDistance, 0.01, 100000)) return fail("focusDistance");

  const subject = input.focusDistance * MM_PER_M;
  // At or inside the front principal plane the thin-lens denominators lose their
  // meaning entirely, so this is a refusal and not a clamp.
  if (subject <= focalLength) return fail("focusDistance");

  const hyperfocal = (focalLength * focalLength) / (fNumber * circleOfConfusion) + focalLength;
  const nearDenominator = hyperfocal + subject - 2 * focalLength;
  // Unreachable while s > f and H > f, which the two guards above already make
  // true; kept because it is the one division left that could be by zero.
  if (nearDenominator <= 0) return fail("focusDistance");

  const near = (subject * (hyperfocal - focalLength)) / nearDenominator;
  const far =
    subject < hyperfocal
      ? (subject * (hyperfocal - focalLength)) / (hyperfocal - subject)
      : undefined;
  return {
    ok: true,
    hyperfocal: hyperfocal / MM_PER_M,
    nearLimit: near / MM_PER_M,
    farLimit: far === undefined ? undefined : far / MM_PER_M,
    totalDepth: far === undefined ? undefined : (far - near) / MM_PER_M,
    farIsInfinite: far === undefined,
  };
}

/**
 * The circle of confusion a „diagonal / divisor" convention implies, in mm.
 *
 * Offered as a separate helper rather than folded into `depthOfField` so that
 * the CoC the depth was computed from is always a value the user can see and
 * edit: a convention applied invisibly is a convention the tool chose.
 */
export function circleOfConfusionFromDiagonal(
  sensorDiagonal: number,
  divisor: number,
): ProResult<{ readonly circleOfConfusion: number }> {
  if (!isInRange(sensorDiagonal, 1, 200)) return fail("sensorDiagonal");
  if (!isInRange(divisor, 200, 5000)) return fail("divisor");
  return { ok: true, circleOfConfusion: sensorDiagonal / divisor };
}

/* ------------------------------------------------------- diffraction limit -- */

/** Green light, 550 nm — the usual thing to examine, and the surface's starting value. */
export const GREEN_WAVELENGTH_NM = 550;

export interface DiffractionInput {
  readonly fNumber: number;
  /** Wavelength being examined, in nm. Which light this is changes the answer. */
  readonly wavelengthNm: number;
  /** Sensor width, in mm. */
  readonly sensorWidth: number;
  /** Horizontal pixel count across that width. */
  readonly pixelCount: number;
}

export interface Diffraction {
  /** Pixel pitch, in micrometres. */
  readonly pixelPitch: number;
  /** Airy disc diameter, first null to first null, in micrometres. */
  readonly airyDiameter: number;
  /** Disc diameter over pixel pitch. A number, not a verdict about sharpness. */
  readonly ratio: number;
  /** The f-number at which the disc is exactly one pixel pitch across. */
  readonly fNumberAtOnePitch: number;
}

/**
 * The Airy disc for an f-number, against the pixel pitch of a named sensor.
 *
 * **It prints numbers and draws no conclusion.** „Diffraction limited" is a
 * threshold somebody chose — one pitch, two pitches, the pitch of the Bayer
 * cell — and the visible effect also depends on the lens's own aberrations,
 * which this far-field unaberrated model knows nothing about. The ratio is the
 * fact; what it means is the photographer's call.
 */
export function diffractionLimit(input: DiffractionInput): ProResult<Diffraction> {
  const { fNumber, wavelengthNm, sensorWidth, pixelCount } = input;
  if (!isInRange(fNumber, 0.5, 256)) return fail("fNumber");
  if (!isInRange(wavelengthNm, 380, 780)) return fail("wavelengthNm");
  if (!isInRange(sensorWidth, 0.5, 200)) return fail("sensorWidth");
  if (!isIntegerIn(pixelCount, 1, 1000000)) return fail("pixelCount");

  const pitch = pixelPitchMm(sensorWidth, pixelCount) * UM_PER_MM;
  const wavelengthUm = wavelengthNm / 1000;
  const perStop = AIRY_DIAMETER_FACTOR * wavelengthUm;
  const diameter = perStop * fNumber;
  return {
    ok: true,
    pixelPitch: pitch,
    airyDiameter: diameter,
    ratio: diameter / pitch,
    fNumberAtOnePitch: pitch / perStop,
  };
}

/* -------------------------------------------------------- equivalent exposure -- */

/** Which of the three target fields was left empty and therefore solved for. */
export type ExposureField = "fNumber" | "shutter" | "iso";

export interface ExposureCombination {
  readonly fNumber: number;
  /** Shutter time, in seconds. */
  readonly shutter: number;
  /** Sensitivity, ISO arithmetic. */
  readonly iso: number;
}

export interface ExposureSolveInput {
  readonly reference: ExposureCombination;
  /** Exactly one of the three must be left undefined; that one is solved for. */
  readonly targetFNumber?: number | undefined;
  readonly targetShutter?: number | undefined;
  readonly targetIso?: number | undefined;
}

export interface ExposureSolved {
  readonly solvedField: ExposureField;
  readonly target: ExposureCombination;
  /** 1/t of the target shutter, unrounded and not snapped to an engraved list. */
  readonly targetShutterDenominator: number;
  readonly referenceEv100: number;
  readonly targetEv100: number;
  /**
   * The stops the target fields the user DID type move the exposure by on their
   * own, positive meaning darker. The solved field cancels exactly this, which
   * is why the two combinations end up at the same EV.
   */
  readonly givenShiftStops: number;
}

/** The reciprocity invariant N^2/(t*S): larger means darker. */
function exposureInvariant(combination: ExposureCombination): number {
  return (
    (combination.fNumber * combination.fNumber) / (combination.shutter * combination.iso)
  );
}

/** EV at ISO 100 = log2(N^2/t) - log2(S/100), the scale's own definition. */
function ev100(combination: ExposureCombination): number {
  return (
    Math.log2((combination.fNumber * combination.fNumber) / combination.shutter) -
    Math.log2(combination.iso / EV_REFERENCE_ISO)
  );
}

/** Range check for one whole combination; returns the offending field's key. */
function combinationFault(combination: ExposureCombination, prefix: string): string | undefined {
  if (!isInRange(combination.fNumber, 0.5, 256)) return `${prefix}FNumber`;
  if (!isInRange(combination.shutter, 1e-6, 3600)) return `${prefix}Shutter`;
  if (!isInRange(combination.iso, 6, 4194304)) return `${prefix}Iso`;
  return undefined;
}

/**
 * The one target value that keeps the exposure equal to a reference.
 *
 * Exactly one of the three target fields is left empty; two empty fields have
 * infinitely many answers and none empty has nothing to solve, so both are
 * refused rather than guessed at. The answer is the computed value, not the
 * nearest mark on the ring — 1/31.25 s is what four times 1/125 s IS.
 */
export function exposureSolve(input: ExposureSolveInput): ProResult<ExposureSolved> {
  const referenceFault = combinationFault(input.reference, "reference");
  if (referenceFault !== undefined) return fail(referenceFault);
  const { targetFNumber, targetShutter, targetIso } = input;
  if (definedCount(targetFNumber, targetShutter, targetIso) !== 2) return fail("targets");
  if (targetFNumber !== undefined && !isInRange(targetFNumber, 0.5, 256)) {
    return fail("targetFNumber");
  }
  if (targetShutter !== undefined && !isInRange(targetShutter, 1e-6, 3600)) {
    return fail("targetShutter");
  }
  if (targetIso !== undefined && !isInRange(targetIso, 6, 4194304)) return fail("targetIso");

  const reference = input.reference;
  let solvedField: ExposureField;
  let target: ExposureCombination;
  let partial: ExposureCombination;
  if (targetFNumber === undefined && targetShutter !== undefined && targetIso !== undefined) {
    // N2 = N1*sqrt((t2*S2)/(t1*S1))
    const ratio = (targetShutter * targetIso) / (reference.shutter * reference.iso);
    solvedField = "fNumber";
    target = { fNumber: reference.fNumber * Math.sqrt(ratio), shutter: targetShutter, iso: targetIso };
    partial = { fNumber: reference.fNumber, shutter: targetShutter, iso: targetIso };
  } else if (targetShutter === undefined && targetFNumber !== undefined && targetIso !== undefined) {
    // t2 = t1*(N2/N1)^2*(S1/S2)
    const apertureRatio = targetFNumber / reference.fNumber;
    const shutter =
      reference.shutter * apertureRatio * apertureRatio * (reference.iso / targetIso);
    solvedField = "shutter";
    target = { fNumber: targetFNumber, shutter, iso: targetIso };
    partial = { fNumber: targetFNumber, shutter: reference.shutter, iso: targetIso };
  } else if (targetIso === undefined && targetFNumber !== undefined && targetShutter !== undefined) {
    // S2 = S1*(N2/N1)^2*(t1/t2)
    const apertureRatio = targetFNumber / reference.fNumber;
    const iso =
      reference.iso * apertureRatio * apertureRatio * (reference.shutter / targetShutter);
    solvedField = "iso";
    target = { fNumber: targetFNumber, shutter: targetShutter, iso };
    partial = { fNumber: targetFNumber, shutter: targetShutter, iso: reference.iso };
  } else {
    return fail("targets");
  }

  return {
    ok: true,
    solvedField,
    target,
    targetShutterDenominator: 1 / target.shutter,
    referenceEv100: ev100(reference),
    targetEv100: ev100(target),
    givenShiftStops: Math.log2(exposureInvariant(partial) / exposureInvariant(reference)),
  };
}

export interface ExposureDifference {
  /** log2(E2/E1), positive meaning the second combination is darker. */
  readonly stops: number;
  readonly firstEv100: number;
  readonly secondEv100: number;
}

/**
 * How far apart two complete combinations are, in stops.
 *
 * Separate from `exposureSolve` because it answers a different question: solving
 * needs one empty field, comparing needs none. The difference is identically
 * `secondEv100 - firstEv100`, since EV at ISO 100 is log2(100*E) — the test
 * asserts that identity rather than trusting two code paths to agree.
 */
export function exposureDifference(
  first: ExposureCombination,
  second: ExposureCombination,
): ProResult<ExposureDifference> {
  const firstFault = combinationFault(first, "first");
  if (firstFault !== undefined) return fail(firstFault);
  const secondFault = combinationFault(second, "second");
  if (secondFault !== undefined) return fail(secondFault);
  return {
    ok: true,
    stops: Math.log2(exposureInvariant(second) / exposureInvariant(first)),
    firstEv100: ev100(first),
    secondEv100: ev100(second),
  };
}

/* -------------------------------------------------------- flash guide number -- */

export interface FlashApertureInput {
  /**
   * The guide number printed on the flash, at ISO 100, in `guideNumberUnit`.
   *
   * A GN is only comparable at a fixed zoom-head position and reflector — two
   * guide numbers off the same flash at different zoom settings are not the same
   * quantity, and the tool does not know which position produced this one.
   */
  readonly guideNumber: number;
  /**
   * Whether `guideNumber` was typed in metres or in feet. There is no default:
   * a foot figure dropped into the metre field reads 3.28x too small silently,
   * which is exactly the mistake a required unit exists to catch.
   */
  readonly guideNumberUnit: LengthUnit;
  /** Flash-to-subject distance, in metres. */
  readonly distance: number;
  readonly iso: number;
  /** A second distance, for the inverse-square comparison. Optional. */
  readonly secondDistance?: number | undefined;
}

export interface FlashAperture {
  /** The guide number rescaled to the sensitivity in use, in metres. */
  readonly guideNumberAtIso: number;
  readonly fNumber: number;
  readonly secondFNumber: number | undefined;
  /** Stops LOST going from the first distance to the second; positive = dimmer. */
  readonly distanceStops: number | undefined;
}

/** GN at a sensitivity: GN_S = GN_100*sqrt(S/100), from the definition itself. */
function guideNumberAtIso(guideNumber: number, iso: number): number {
  return guideNumber * Math.sqrt(iso / EV_REFERENCE_ISO);
}

/**
 * The aperture a guide number calls for at a distance, and what moving the light
 * costs in stops.
 *
 * **The guide number is the user's, and the tool neither picks nor checks it.**
 * A published GN is a bare point source in free space at one zoom setting;
 * reflectors, modifiers, bounce and a zoom head all change the real figure, and
 * a tool that „corrected" for them would be inventing a measurement of somebody
 * else's flash.
 */
export function flashAperture(input: FlashApertureInput): ProResult<FlashAperture> {
  const { distance, iso } = input;
  // Convert to metres FIRST: the 1-200 range is a statement about physically
  // plausible guide numbers, and it means the same thing regardless of which
  // unit the flash's own manual happened to print it in.
  const guideNumberM =
    input.guideNumberUnit === "ft" ? input.guideNumber * METRES_PER_FOOT : input.guideNumber;
  if (!isInRange(guideNumberM, 1, 200)) return fail("guideNumber");
  if (!isInRange(distance, 0.05, 200)) return fail("distance");
  if (!isInRange(iso, 6, 4194304)) return fail("iso");
  const secondDistance = input.secondDistance;
  if (secondDistance !== undefined && !isInRange(secondDistance, 0.05, 200)) {
    return fail("secondDistance");
  }

  const scaled = guideNumberAtIso(guideNumberM, iso);
  return {
    ok: true,
    guideNumberAtIso: scaled,
    fNumber: scaled / distance,
    secondFNumber: secondDistance === undefined ? undefined : scaled / secondDistance,
    // Illumination falls with 1/d^2, so the change is 2*log2(d2/d1).
    distanceStops:
      secondDistance === undefined ? undefined : 2 * Math.log2(secondDistance / distance),
  };
}

export interface FlashDistanceInput {
  /** In `guideNumberUnit` — see `FlashApertureInput.guideNumber`. */
  readonly guideNumber: number;
  readonly guideNumberUnit: LengthUnit;
  readonly fNumber: number;
  readonly iso: number;
}

/** The distance a guide number reaches at a chosen aperture: d = GN_S/N. */
export function flashDistance(
  input: FlashDistanceInput,
): ProResult<{ readonly guideNumberAtIso: number; readonly distance: number }> {
  const { fNumber, iso } = input;
  const guideNumberM =
    input.guideNumberUnit === "ft" ? input.guideNumber * METRES_PER_FOOT : input.guideNumber;
  if (!isInRange(guideNumberM, 1, 200)) return fail("guideNumber");
  if (!isInRange(fNumber, 0.5, 256)) return fail("fNumber");
  if (!isInRange(iso, 6, 4194304)) return fail("iso");
  const scaled = guideNumberAtIso(guideNumberM, iso);
  return { ok: true, guideNumberAtIso: scaled, distance: scaled / fNumber };
}

/* ----------------------------------------------------- frame rate conform -- */

export interface FrameRateConformInput {
  readonly captureFps: number;
  readonly timelineFps: number;
  /** Clip length in seconds, OR a frame count — exactly one of the two. */
  readonly sourceDuration?: number | undefined;
  readonly frameCount?: number | undefined;
  /** Wanted slow-motion multiplier: 5 means five times slower than real time. */
  readonly slowMotionFactor?: number | undefined;
}

export interface FrameRateConform {
  /** The rates actually used, after a labelled NTSC rate became its rational. */
  readonly captureFps: number;
  readonly timelineFps: number;
  readonly frameCount: number;
  readonly speedFactor: number;
  readonly speedPercent: number;
  /** The clip's own length at the capture rate, in seconds. */
  readonly sourceDuration: number;
  readonly conformedDuration: number;
  /** conformed - source, in seconds; positive means the clip got longer. */
  readonly drift: number;
  /** The capture rate the wanted slow-motion factor needs, or undefined. */
  readonly requiredCaptureFps: number | undefined;
}

/**
 * What happens to a clip when it is laid on a timeline of a different rate.
 *
 * **A conform preserves the frame COUNT and changes the duration** — that is the
 * whole definition, and it is why an hour at 24 fps becomes 01:00:03.600 at
 * 23.976 rather than staying an hour. The 3.6 s is not an error in the
 * arithmetic; it is the pull-down, and it is exactly the amount the audio has to
 * be pulled by to stay in sync.
 *
 * A duration that does not land on a whole frame is rounded to the nearest one
 * and the exact source duration for THAT frame count is reported back, so the
 * two numbers on the surface can never disagree.
 */
export function frameRateConform(input: FrameRateConformInput): ProResult<FrameRateConform> {
  const captureFps = exactFrameRate(input.captureFps);
  const timelineFps = exactFrameRate(input.timelineFps);
  if (!isInRange(captureFps, 0.1, 10000)) return fail("captureFps");
  if (!isInRange(timelineFps, 0.1, 10000)) return fail("timelineFps");
  const duration = input.sourceDuration;
  const typedFrames = input.frameCount;
  if (definedCount(duration, typedFrames) !== 1) return fail("clipLength");

  let frameCount: number;
  if (duration !== undefined) {
    if (!isInRange(duration, 0.001, 864000)) return fail("sourceDuration");
    frameCount = Math.round(captureFps * duration);
    if (frameCount < 1) return fail("sourceDuration");
  } else if (typedFrames !== undefined) {
    if (!isIntegerIn(typedFrames, 1, 100000000)) return fail("frameCount");
    frameCount = typedFrames;
  } else {
    return fail("clipLength");
  }

  const slowMotionFactor = input.slowMotionFactor;
  if (slowMotionFactor !== undefined && !isInRange(slowMotionFactor, 0.01, 100)) {
    return fail("slowMotionFactor");
  }

  const sourceDuration = frameCount / captureFps;
  const conformedDuration = frameCount / timelineFps;
  const speedFactor = timelineFps / captureFps;
  return {
    ok: true,
    captureFps,
    timelineFps,
    frameCount,
    speedFactor,
    speedPercent: 100 * speedFactor,
    sourceDuration,
    conformedDuration,
    drift: conformedDuration - sourceDuration,
    // k is the slow-motion multiplier, so five times slower needs five times the
    // timeline rate. The convention is stated because the reciprocal is just as
    // common a way to write it.
    requiredCaptureFps:
      slowMotionFactor === undefined ? undefined : timelineFps * slowMotionFactor,
  };
}

/* ------------------------------------------------------ illuminance to aperture -- */

export type IlluminanceUnit = "lx" | "fc";

export interface IlluminanceInput {
  readonly illuminance: number;
  readonly unit: IlluminanceUnit;
  /**
   * Required only on the path that computes `fNumber` — see
   * `calibrationConstant`. The lx <-> fc conversion below needs neither iso
   * nor shutter, so a user who has typed only an illuminance must still get
   * that conversion rather than a refusal for a field the answer never uses.
   */
  readonly iso?: number | undefined;
  /** Shutter time, in seconds. Same optionality as `iso`. */
  readonly shutter?: number | undefined;
  /**
   * The incident-meter calibration constant C, read off the user's own meter.
   *
   * ISO 2720:1974 fixes only a permitted RANGE and every maker picks its own
   * value inside it — around 250 for a flat receptor, around 340 for a
   * hemispherical one. A standards body chose that range and can revise it, so
   * this is `regulated`-tier: never embedded, never defaulted. It is optional
   * rather than required because the unit conversion below it does not need it
   * at all — a missing C must not blank out the one line that did not ask for it.
   */
  readonly calibrationConstant?: number | undefined;
}

export interface IlluminanceAperture {
  readonly lux: number;
  readonly footCandles: number;
  /** Undefined when no calibration constant was given — see `calibrationConstant`. */
  readonly fNumber: number | undefined;
  /** The nearest third-stop mark, computed as 2^(k/6) — never read from a table. */
  readonly nearestThirdStop: number | undefined;
  /** k in 2^(k/6): 0 is f/1, 6 is f/2, 9 is f/2.83. */
  readonly thirdStopIndex: number | undefined;
}

/**
 * Illuminance in both units, and the aperture an incident reading implies.
 *
 * The incident metering equation is E*S/C = N^2/t, so N = sqrt(E*S*t/C) with E
 * in lux. **A reflected-light constant K is a different quantity** measured
 * against a different receptor and is not accepted here; entering one would
 * silently produce an aperture that is wrong by a stop or so.
 *
 * The tool converts units and computes an aperture. It says nothing about
 * whether a space is well lit or meets any requirement for lighting — that is a
 * different question with a different constant and a different standard.
 *
 * **A missing calibration constant still gets a unit conversion, and does not
 * force ISO or shutter to be typed either.** lx and fc are definitional and
 * owe C, S and t nothing; refusing the whole surface for a field the answer
 * never reads would be repairing an incomplete question by throwing away the
 * part that was already answerable. `iso` and `shutter` are validated only on
 * the branch that actually multiplies them into `fNumber`.
 */
export function illuminanceToAperture(input: IlluminanceInput): ProResult<IlluminanceAperture> {
  const { illuminance } = input;
  if (!isInRange(illuminance, 0.001, 1000000)) return fail("illuminance");
  const calibrationConstant = input.calibrationConstant;
  if (calibrationConstant !== undefined && !isInRange(calibrationConstant, 100, 800)) {
    return fail("calibrationConstant");
  }

  const lux = input.unit === "fc" ? illuminance * LUX_PER_FOOT_CANDLE : illuminance;
  const footCandles = lux * SQUARE_METRES_PER_SQUARE_FOOT;
  if (calibrationConstant === undefined) {
    return {
      ok: true,
      lux,
      footCandles,
      fNumber: undefined,
      nearestThirdStop: undefined,
      thirdStopIndex: undefined,
    };
  }

  const { iso, shutter } = input;
  if (!isInRange(iso, 6, 4194304)) return fail("iso");
  if (!isInRange(shutter, 1e-6, 3600)) return fail("shutter");

  const fNumber = Math.sqrt((lux * iso * shutter) / calibrationConstant);
  // The engraved scale is 2^(k/6). Rounding in log space picks the nearest mark
  // in STOPS, which is not always the nearest in f-number, so all three
  // neighbours are measured and the closest one wins.
  const centre = Math.round(6 * Math.log2(fNumber));
  let thirdStopIndex = centre;
  let nearestThirdStop = Math.pow(2, centre / 6);
  for (const candidate of [centre - 1, centre + 1]) {
    const mark = Math.pow(2, candidate / 6);
    if (Math.abs(fNumber - mark) < Math.abs(fNumber - nearestThirdStop)) {
      thirdStopIndex = candidate;
      nearestThirdStop = mark;
    }
  }
  return { ok: true, lux, footCandles, fNumber, nearestThirdStop, thirdStopIndex };
}

/* -------------------------------------------------------------- mired shift -- */

export interface MiredShiftInput {
  /** Source colour temperature, in kelvin. */
  readonly sourceTemperature: number;
  /** Target temperature in kelvin — use it to ask how far apart two are. */
  readonly targetTemperature?: number | undefined;
  /** Mired shift to apply, signed, in MK^-1 — use it to ask where a gel lands. */
  readonly shift?: number | undefined;
}

export interface MiredShift {
  readonly sourceMired: number;
  readonly resultMired: number;
  /** Signed: negative is cooling (towards blue), positive is warming. */
  readonly shift: number;
  readonly resultTemperature: number;
}

/**
 * The mired distance between two colour temperatures, or where a mired shift
 * lands.
 *
 * **Mireds are the reciprocal scale because gels are linear in it and not in
 * kelvin**: the same gel that moves 3200 K to 5500 K does not move 5500 K to
 * 7800 K. That is also why the answer is the computed temperature and not the
 * one printed on the gel's sleeve — a full CTB on 3200 K lands at 5510 K, not
 * the advertised 5600 K, and showing that is the point of the tool.
 *
 * Giving both a target and a shift is not an error: the target wins and the
 * shift comes back as the difference it actually implies.
 */
export function miredShift(input: MiredShiftInput): ProResult<MiredShift> {
  const { sourceTemperature } = input;
  if (!isInRange(sourceTemperature, 1000, 40000)) return fail("sourceTemperature");
  const targetTemperature = input.targetTemperature;
  if (targetTemperature !== undefined && !isInRange(targetTemperature, 1000, 40000)) {
    return fail("targetTemperature");
  }
  const shift = input.shift;
  if (shift !== undefined && !isInRange(shift, -500, 500)) return fail("shift");

  const sourceMired = MIRED_SCALE / sourceTemperature;
  if (targetTemperature !== undefined) {
    const resultMired = MIRED_SCALE / targetTemperature;
    return {
      ok: true,
      sourceMired,
      resultMired,
      shift: resultMired - sourceMired,
      resultTemperature: targetTemperature,
    };
  }
  if (shift === undefined) return fail("target");
  const resultMired = sourceMired + shift;
  // A shift past the reciprocal origin has no kelvin answer at all: the refusal
  // is the honest result, where a negative or infinite temperature would not be.
  if (!isPositive(resultMired)) return fail("shift");
  return {
    ok: true,
    sourceMired,
    resultMired,
    shift,
    resultTemperature: MIRED_SCALE / resultMired,
  };
}

/* -------------------------------------------------------------- motion blur -- */

export type SpeedUnit = "m/s" | "km/h";

export interface MotionGeometry {
  readonly speed: number;
  readonly speedUnit: SpeedUnit;
  /** Subject distance, in metres, from the front principal plane. */
  readonly subjectDistance: number;
  /** Focal length, in mm. */
  readonly focalLength: number;
  readonly sensorWidth: number;
  readonly pixelCount: number;
}

export interface MotionBlurInput extends MotionGeometry {
  /** Shutter time, in seconds. */
  readonly shutter: number;
}

export interface MotionBlur {
  readonly blurMillimetres: number;
  readonly blurPixels: number;
  /** Magnification f/(D-f) — the thin-lens image scale, not 1/D. */
  readonly magnification: number;
}

export interface MotionShutterInput extends MotionGeometry {
  /** How much blur is acceptable, in pixels. */
  readonly acceptableBlurPixels: number;
}

export interface MotionShutter {
  readonly shutter: number;
  /** 1/t exactly, before any rounding. */
  readonly exactDenominator: number;
  /**
   * 1/t rounded UP to the next whole number — the FASTER shutter. Rounding the
   * denominator down would hand back a longer exposure than was asked for and
   * therefore more blur than the user said they would accept.
   */
  readonly shutterDenominator: number;
}

interface MotionResolved {
  readonly speedMmPerSecond: number;
  readonly distanceMm: number;
  readonly focalLength: number;
  /** Pixel pitch, in mm. */
  readonly pitchMm: number;
}

function resolveMotionGeometry(input: MotionGeometry): ProResult<MotionResolved> {
  if (!isInRange(input.focalLength, 0.5, 5000)) return fail("focalLength");
  if (!isInRange(input.sensorWidth, 0.5, 200)) return fail("sensorWidth");
  if (!isIntegerIn(input.pixelCount, 1, 1000000)) return fail("pixelCount");
  if (!isInRange(input.subjectDistance, 0.05, 100000)) return fail("subjectDistance");
  const metresPerSecond = input.speedUnit === "km/h" ? input.speed * MS_PER_KMH : input.speed;
  if (!isInRange(metresPerSecond, 0.001, 1000)) return fail("speed");
  const distanceMm = input.subjectDistance * MM_PER_M;
  // Inside the focal length the magnification is negative or undefined; there is
  // no image to blur, so this is a refusal.
  if (distanceMm <= input.focalLength) return fail("subjectDistance");
  return {
    ok: true,
    speedMmPerSecond: metresPerSecond * MM_PER_M,
    distanceMm,
    focalLength: input.focalLength,
    pitchMm: pixelPitchMm(input.sensorWidth, input.pixelCount),
  };
}

/**
 * How far a moving subject smears across the sensor during an exposure.
 *
 * The model is a thin lens with the motion ACROSS the optical axis; a subject
 * coming towards the camera changes size rather than position and is outside
 * this arithmetic entirely, which the surface states rather than the tool
 * pretending otherwise.
 */
export function motionBlurPixels(input: MotionBlurInput): ProResult<MotionBlur> {
  const geometry = resolveMotionGeometry(input);
  if (!geometry.ok) return geometry;
  if (!isInRange(input.shutter, 1e-6, 3600)) return fail("shutter");
  const magnification = geometry.focalLength / (geometry.distanceMm - geometry.focalLength);
  const blurMillimetres = geometry.speedMmPerSecond * input.shutter * magnification;
  return {
    ok: true,
    magnification,
    blurMillimetres,
    blurPixels: blurMillimetres / geometry.pitchMm,
  };
}

/** The same geometry read backwards: the shutter that holds blur to B pixels. */
export function motionBlurShutter(input: MotionShutterInput): ProResult<MotionShutter> {
  const geometry = resolveMotionGeometry(input);
  if (!geometry.ok) return geometry;
  if (!isInRange(input.acceptableBlurPixels, 0.1, 1000)) return fail("acceptableBlurPixels");
  const shutter =
    (input.acceptableBlurPixels * geometry.pitchMm * (geometry.distanceMm - geometry.focalLength)) /
    (geometry.focalLength * geometry.speedMmPerSecond);
  const exactDenominator = 1 / shutter;
  return {
    ok: true,
    shutter,
    exactDenominator,
    shutterDenominator: Math.ceil(exactDenominator),
  };
}

/* ---------------------------------------------------------------- ND filter -- */

/** One filter's strength, given as exactly one of the three equivalent forms. */
export interface NdFilterStrength {
  readonly stops?: number | undefined;
  /** Optical density D = log10(F). */
  readonly density?: number | undefined;
  /** Filter factor F = 2^stops = 10^D. */
  readonly factor?: number | undefined;
}

export interface NdFilterInput {
  /** Shutter time without the filter, in seconds. */
  readonly baseShutter: number;
  /** The stack, in any order; at least one entry. */
  readonly filters: readonly NdFilterStrength[];
}

export interface NdFilterExposure {
  readonly stops: number;
  readonly density: number;
  readonly factor: number;
  /** Resulting shutter time, in seconds. */
  readonly shutter: number;
}

/**
 * A stack of ND filters in all three of the ways they are sold, and the exposure
 * that results.
 *
 * **Stacking is additive in stops and in density, and multiplicative in factor.**
 * Everything is normalised to stops on entry for exactly that reason: adding two
 * factors is the mistake this tool exists to prevent (6 stops plus 0.9 D is
 * 508.4x, not 71x and not 1088x).
 *
 * A filter given in two forms at once is refused rather than guessed at — the
 * two numbers may disagree, and picking one would be inventing an answer.
 */
export function ndFilterExposure(input: NdFilterInput): ProResult<NdFilterExposure> {
  if (!isInRange(input.baseShutter, 1e-6, 3600)) return fail("baseShutter");
  if (input.filters.length === 0) return fail("filters");

  let stops = 0;
  for (const filter of input.filters) {
    if (definedCount(filter.stops, filter.density, filter.factor) !== 1) return fail("filterForm");
    if (filter.stops !== undefined) {
      if (!isInRange(filter.stops, 0, 24)) return fail("stops");
      stops += filter.stops;
    } else if (filter.density !== undefined) {
      if (!isInRange(filter.density, 0, 7.5)) return fail("density");
      stops += filter.density / LOG10_2;
    } else if (filter.factor !== undefined) {
      if (!isInRange(filter.factor, 1, 16777216)) return fail("factor");
      stops += Math.log2(filter.factor);
    }
  }
  const factor = Math.pow(2, stops);
  return {
    ok: true,
    stops,
    density: stops * LOG10_2,
    factor,
    shutter: input.baseShutter * factor,
  };
}

/* --------------------------------------------------------------- PQ / nits -- */

/**
 * SMPTE ST 2084:2014 and ITU-R BT.2100-2 (07/2018), the PQ transfer function.
 * The five constants are exact dyadic rationals, which is why they are written
 * as decimals here without loss: m1 = 2610/16384, m2 = (2523/4096)*128,
 * c1 = 3424/4096, c2 = (2413/4096)*32, c3 = (2392/4096)*32.
 *
 * They satisfy c1 = c3 - c2 + 1 identically. The test asserts that identity: a
 * single mistyped digit in any of the three changes it, and the failure is
 * caught by arithmetic rather than by somebody noticing that peak white came out
 * at 9997 nits.
 */
export const PQ_M1 = 0.1593017578125;
export const PQ_M2 = 78.84375;
export const PQ_C1 = 0.8359375;
export const PQ_C2 = 18.8515625;
export const PQ_C3 = 18.6875;

/** ST 2084 defines the curve up to 10000 cd/m^2 and not one nit further. */
export const PQ_PEAK_LUMINANCE = 10000;

/** 1/m1 = 16384/2610 = 6.277394636015326. */
const PQ_INV_M1 = 1 / PQ_M1;

export type PqBitDepth = 10 | 12;
export type PqRange = "narrow" | "full";

export interface PqCodeValues {
  /** BT.2100 narrow (video) range: 64..940 at 10 bit, 256..3760 at 12 bit. */
  readonly narrow: number;
  /** Full range: 0..2^n - 1. */
  readonly full: number;
}

export interface PqPoint {
  /** Normalised PQ signal, 0..1. */
  readonly signal: number;
  /** Luminance, in cd/m^2. */
  readonly luminance: number;
  readonly code: PqCodeValues;
}

/**
 * BT.2100 quantisation at bit depth n: narrow range scales 16 and 219 by
 * 2^(n-8) — round(876*N + 64) at 10 bit — and full range spans 2^n - 1.
 * Rounding is half-up, which `Math.round` is for non-negative values.
 */
function pqCodeValues(signal: number, bitDepth: PqBitDepth): PqCodeValues {
  const maxCode = Math.pow(2, bitDepth) - 1;
  const scale = Math.pow(2, bitDepth - 8);
  const clamp = (code: number): number => Math.min(Math.max(code, 0), maxCode);
  return {
    narrow: clamp(Math.round(signal * 219 * scale + 16 * scale)),
    full: clamp(Math.round(signal * maxCode)),
  };
}

/** The PQ EOTF: signal to light, ST 2084 section 4.1. */
function pqLuminanceOf(signal: number): number {
  const p = Math.pow(signal, 1 / PQ_M2);
  // The max(p - c1, 0) clamp is the small-signal region, where p < c1 and the
  // numerator would go negative; dropping it turns black into NaN.
  const numerator = Math.max(p - PQ_C1, 0);
  const denominator = PQ_C2 - PQ_C3 * p;
  return PQ_PEAK_LUMINANCE * Math.pow(numerator / denominator, PQ_INV_M1);
}

/** The inverse: light to signal. */
function pqSignalOf(luminance: number): number {
  const yp = Math.pow(luminance / PQ_PEAK_LUMINANCE, PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * yp) / (1 + PQ_C3 * yp), PQ_M2);
}

/**
 * Luminance and both quantisations for a normalised PQ signal.
 *
 * **Above 10000 cd/m^2 the curve is not defined**, so a signal outside 0..1 is
 * refused rather than extrapolated: PQ is absolute, and an extrapolated nit
 * value would be a number with no standard behind it.
 */
export function pqFromSignal(signal: number, bitDepth: PqBitDepth): ProResult<PqPoint> {
  if (!isInRange(signal, 0, 1)) return fail("signal");
  return {
    ok: true,
    signal,
    luminance: pqLuminanceOf(signal),
    code: pqCodeValues(signal, bitDepth),
  };
}

/** The same point reached from the luminance: 0..10000 cd/m^2, nothing above. */
export function pqFromLuminance(luminance: number, bitDepth: PqBitDepth): ProResult<PqPoint> {
  if (!isNonNegative(luminance) || luminance > PQ_PEAK_LUMINANCE) return fail("luminance");
  const signal = pqSignalOf(luminance);
  return { ok: true, signal, luminance, code: pqCodeValues(signal, bitDepth) };
}

/**
 * The normalised signal a quantised code value carries.
 *
 * Narrow-range codes below black or above peak map outside 0..1, where the curve
 * has no luminance at all; those are refused rather than clamped, because
 * clamping would report footroom as if it were black.
 */
export function pqSignalFromCode(
  code: number,
  bitDepth: PqBitDepth,
  range: PqRange,
): ProResult<{ readonly signal: number }> {
  const maxCode = Math.pow(2, bitDepth) - 1;
  if (!isIntegerIn(code, 0, maxCode)) return fail("code");
  const scale = Math.pow(2, bitDepth - 8);
  const signal = range === "narrow" ? (code - 16 * scale) / (219 * scale) : code / maxCode;
  return isInRange(signal, 0, 1) ? { ok: true, signal } : fail("code");
}

/* -------------------------------------------------------- raster image size -- */

/** The depths a pixel is actually stored at; 2, 10 or 24 are not among them. */
export const RASTER_BIT_DEPTHS: readonly number[] = [1, 8, 16, 32];

export type CapacityUnit = "GB" | "GiB";

/**
 * Bytes in a `{ value, unit }` capacity figure: GB is 10^9 B, GiB is 2^30 B.
 *
 * Written once and shared by `rasterImageSize` (`capacity`) and `videoStorage`
 * (`size`), which had each spelled the same ternary independently — the same
 * one-helper-not-N-copies rule `sensorDiagonalMm` and `pixelPitchMm` already
 * follow elsewhere in this file.
 */
function capacityBytesOf(capacity: { readonly value: number; readonly unit: CapacityUnit }): number {
  return capacity.value * (capacity.unit === "GiB" ? BYTES_PER_GIB : BYTES_PER_GB);
}

export interface RasterSizeInput {
  readonly width: number;
  readonly height: number;
  /** 1 grayscale, 3 RGB, 4 RGBA, more for spot channels. */
  readonly channels: number;
  readonly bitDepth: number;
  /** Layers or frames of the same size. */
  readonly layers: number;
  /** Available capacity, optional; the unit is part of the number. */
  readonly capacity?: { readonly value: number; readonly unit: CapacityUnit } | undefined;
  /** A known average file size in MB (10^6 B), used INSTEAD of the computed size. */
  readonly averageFileSizeMb?: number | undefined;
}

export interface RasterImageSize {
  readonly bytes: number;
  readonly megabytes: number;
  readonly mebibytes: number;
  readonly gigabytes: number;
  readonly gibibytes: number;
  /** How many such files fit in the capacity, rounded DOWN. Undefined with no capacity. */
  readonly filesThatFit: number | undefined;
}

/**
 * The uncompressed size of pixel data, and how many of them fit somewhere.
 *
 * **This is the size of the pixel data and nothing else** — no container header,
 * no thumbnail, no compression — so it is not a prediction of a RAW or JPEG
 * file, and the surface says so. It is the right number for a working buffer and
 * the wrong one for a card estimate, which is what the typed average file size
 * is for: when given, it replaces the computed size in the „how many fit" line.
 *
 * MB is 10^6 B and MiB is 2^20 B, side by side, because that difference is the
 * whole reason a card looks smaller than the label promised.
 *
 * **Each row is padded up to a whole byte before it is multiplied by height.**
 * `width*height*channels*bitDepth/8` is only exact when `bitDepth` is itself a
 * multiple of 8; at 1-bit depth a row of `width*channels` bits almost never is,
 * and every real uncompressed format pads the row rather than splitting a byte
 * across two of them. Rounding the WHOLE product instead of the row would be
 * the wrong shape of the same bug — it forgives seven bits once per image
 * instead of once per row.
 */
export function rasterImageSize(input: RasterSizeInput): ProResult<RasterImageSize> {
  const { width, height, channels, bitDepth, layers } = input;
  if (!isIntegerIn(width, 1, 1000000)) return fail("width");
  if (!isIntegerIn(height, 1, 1000000)) return fail("height");
  if (!isIntegerIn(channels, 1, 16)) return fail("channels");
  if (!RASTER_BIT_DEPTHS.includes(bitDepth)) return fail("bitDepth");
  if (!isIntegerIn(layers, 1, 10000)) return fail("layers");
  const capacity = input.capacity;
  if (capacity !== undefined && !isInRange(capacity.value, 0.000001, 1000000)) {
    return fail("capacity");
  }
  const averageFileSizeMb = input.averageFileSizeMb;
  if (averageFileSizeMb !== undefined && !isInRange(averageFileSizeMb, 0.001, 1000000)) {
    return fail("averageFileSizeMb");
  }

  const bytesPerRow = Math.ceil((width * channels * bitDepth) / BITS_PER_BYTE);
  const bytes = bytesPerRow * height * layers;
  let filesThatFit: number | undefined;
  if (capacity !== undefined) {
    const capacityBytes = capacityBytesOf(capacity);
    const fileBytes =
      averageFileSizeMb === undefined ? bytes : averageFileSizeMb * BYTES_PER_MB;
    // floorSnapped, not Math.floor: capacityBytes and fileBytes are each a user
    // figure times a constant, and their quotient lands one ULP under a whole
    // file count often enough to matter — "how many whole files fit" is exactly
    // the count `floorSnapped` exists for.
    filesThatFit = isPositive(fileBytes) ? floorSnapped(capacityBytes / fileBytes) : undefined;
  }
  return {
    ok: true,
    bytes,
    megabytes: bytes / BYTES_PER_MB,
    mebibytes: bytes / BYTES_PER_MIB,
    gigabytes: bytes / BYTES_PER_GB,
    gibibytes: bytes / BYTES_PER_GIB,
    filesThatFit,
  };
}

/* ----------------------------------------------------------- SMPTE timecode -- */

/** The counted rates. 23.976 is not one of them: it COUNTS at 24. */
const TIMECODE_NOMINAL_RATES: readonly number[] = [24, 25, 30, 50, 60];

export interface TimecodeFormat {
  /**
   * Frames per second of COUNTING: 24 for both 24 and 24000/1001, 30 for both 30
   * and 30000/1001, 60 for both 60 and 60000/1001. Timecode always counts by the
   * nominal rate — that mismatch is the entire reason drop-frame exists.
   */
  readonly nominalRate: number;
  /** True when the real rate is nominalRate*1000/1001 (23.976, 29.97, 59.94). */
  readonly ntscPullDown: boolean;
  readonly dropFrame: boolean;
}

export interface TimecodeParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly frames: number;
}

/** Two labels are skipped per minute at 30, four at 60 — labels, never frames. */
function droppedLabels(nominalRate: number): number {
  return nominalRate === 60 ? 4 : 2;
}

function formatFault(format: TimecodeFormat): string | undefined {
  if (!TIMECODE_NOMINAL_RATES.includes(format.nominalRate)) return "nominalRate";
  // Drop-frame is defined only for the NTSC-derived 30 and 60 families. At 25 it
  // would be a notation for a drift that does not exist.
  const dropCapable =
    format.ntscPullDown && (format.nominalRate === 30 || format.nominalRate === 60);
  if (format.dropFrame && !dropCapable) return "dropFrame";
  return undefined;
}

/** Seconds of real time one frame occupies: 1001/(1000*N) under pull-down. */
function secondsPerFrame(format: TimecodeFormat): number {
  return format.ntscPullDown ? 1001 / (1000 * format.nominalRate) : 1 / format.nominalRate;
}

/** Frames in 24 hours of this format — the largest operand that means anything. */
function framesPerDay(format: TimecodeFormat): number {
  const counted = 24 * 3600 * format.nominalRate;
  if (!format.dropFrame) return counted;
  const minutes = 24 * 60;
  return counted - droppedLabels(format.nominalRate) * (minutes - minutes / 10);
}

/**
 * A timecode label to an absolute frame number.
 *
 * **A drop-frame label that does not exist is refused, never repaired.**
 * 00:01:00;00 and 00:01:00;01 at 29.97 DF are not late or early, they are
 * numbers the notation skips, and a tool that silently read them as 00:01:00;02
 * would be inventing two frames of content.
 */
export function timecodeToFrames(
  parts: TimecodeParts,
  format: TimecodeFormat,
): ProResult<{ readonly frames: number }> {
  const fault = formatFault(format);
  if (fault !== undefined) return fail(fault);
  const nominal = format.nominalRate;
  if (!isIntegerIn(parts.hours, 0, 23)) return fail("hours");
  if (!isIntegerIn(parts.minutes, 0, 59)) return fail("minutes");
  if (!isIntegerIn(parts.seconds, 0, 59)) return fail("seconds");
  if (!isIntegerIn(parts.frames, 0, nominal - 1)) return fail("frames");

  const totalMinutes = parts.hours * 60 + parts.minutes;
  const counted = (totalMinutes * 60 + parts.seconds) * nominal + parts.frames;
  if (!format.dropFrame) return { ok: true, frames: counted };

  const dropped = droppedLabels(nominal);
  if (parts.seconds === 0 && parts.frames < dropped && parts.minutes % 10 !== 0) {
    return fail("droppedLabel");
  }
  return {
    ok: true,
    frames: counted - dropped * (totalMinutes - Math.floor(totalMinutes / 10)),
  };
}

/**
 * A frame number back to its label.
 *
 * The drop-frame inverse works in ten-minute blocks because that is the period
 * of the rule: a block is 10*60*N - 9*D frames (17982 at 29.97) and each block
 * skips 9*D labels, since the tenth minute of every block drops nothing. The
 * `remainder >= D` guard is what protects that tenth minute — without it, the
 * first frames of a block get an extra D added and 00:10:00;00 comes back as
 * 00:10:00;02.
 *
 * **It wraps at 24 hours, because a LABEL is a reading on a 24-hour clock and
 * not a counter.** `framesPerDay(format)` is, by construction, the exact frame
 * value `timecodeToFrames` produces for 24:00:00;00 — the same accounting run
 * forward — so taking `frames mod framesPerDay` lands 24:00:00;00 on 00:00:00;00
 * exactly rather than on an hour field that has run past 23. An unbounded hour
 * count is not a reading any deck can show; the total frame count that does NOT
 * wrap still lives in `TimecodeOperationResult.frames`, so nothing is lost by
 * wrapping the label — only the label wraps.
 */
export function framesToTimecode(
  frames: number,
  format: TimecodeFormat,
): ProResult<{ readonly timecode: TimecodeParts }> {
  const fault = formatFault(format);
  if (fault !== undefined) return fail(fault);
  if (!Number.isInteger(frames) || frames < 0) return fail("frames");
  const nominal = format.nominalRate;
  const perDay = framesPerDay(format);
  const wrapped = perDay > 0 ? frames % perDay : frames;

  let labelFrames = wrapped;
  if (format.dropFrame) {
    const dropped = droppedLabels(nominal);
    const perMinute = 60 * nominal - dropped;
    const perBlock = 10 * 60 * nominal - 9 * dropped;
    const blocks = Math.floor(wrapped / perBlock);
    const remainder = wrapped % perBlock;
    labelFrames =
      wrapped +
      9 * dropped * blocks +
      (remainder >= dropped ? dropped * Math.floor((remainder - dropped) / perMinute) : 0);
  }
  const totalSeconds = Math.floor(labelFrames / nominal);
  return {
    ok: true,
    timecode: {
      hours: Math.floor(totalSeconds / 3600),
      minutes: Math.floor(totalSeconds / 60) % 60,
      seconds: totalSeconds % 60,
      frames: labelFrames % nominal,
    },
  };
}

/** Real elapsed time for a frame count: frames*1001/(1000*N) under pull-down. */
export function timecodeSeconds(
  frames: number,
  format: TimecodeFormat,
): ProResult<{ readonly seconds: number }> {
  const fault = formatFault(format);
  if (fault !== undefined) return fail(fault);
  if (!Number.isInteger(frames)) return fail("frames");
  return { ok: true, seconds: frames * secondsPerFrame(format) };
}

export interface TimecodeOperationInput {
  readonly a: TimecodeParts;
  readonly format: TimecodeFormat;
  /** The second operand as a label, OR as a frame count — exactly one. */
  readonly operandTimecode?: TimecodeParts | undefined;
  readonly operandFrames?: number | undefined;
  readonly operation: "add" | "subtract";
}

export interface TimecodeOperationResult {
  /** Signed frame count of the result — unbounded, and NOT wrapped at 24 h. */
  readonly frames: number;
  readonly negative: boolean;
  /**
   * The label of the absolute value, WRAPPED at 24 hours the way a deck reads
   * it back (24:00:00;00 is 00:00:00;00) — see `framesToTimecode`. The sign is
   * carried by `negative`; a duration over a day is still exact in `frames`.
   */
  readonly timecode: TimecodeParts;
  /** Real elapsed time in seconds, signed like `frames`. */
  readonly elapsedSeconds: number;
}

/**
 * Timecode arithmetic, done on frame numbers rather than on the label.
 *
 * Adding labels field by field is the classic mistake: at 29.97 DF the labels
 * are not a positional number system — minute boundaries skip two of them — so
 * the only safe route is label to frames, arithmetic, frames back to label.
 */
export function timecodeOperation(
  input: TimecodeOperationInput,
): ProResult<TimecodeOperationResult> {
  const first = timecodeToFrames(input.a, input.format);
  if (!first.ok) return first;
  // Exactly one operand: a label or a frame count, never both and never neither.
  if ((input.operandTimecode === undefined) === (input.operandFrames === undefined)) {
    return fail("operand");
  }

  let operand: number;
  if (input.operandTimecode !== undefined) {
    const second = timecodeToFrames(input.operandTimecode, input.format);
    if (!second.ok) return second;
    operand = second.frames;
  } else if (input.operandFrames !== undefined) {
    if (!isIntegerIn(input.operandFrames, 0, framesPerDay(input.format))) {
      return fail("operandFrames");
    }
    operand = input.operandFrames;
  } else {
    return fail("operand");
  }

  const signed = input.operation === "subtract" ? first.frames - operand : first.frames + operand;
  const label = framesToTimecode(Math.abs(signed), input.format);
  if (!label.ok) return label;
  return {
    ok: true,
    frames: signed,
    negative: signed < 0,
    timecode: label.timecode,
    elapsedSeconds: signed * secondsPerFrame(input.format),
  };
}

export interface TimecodeDrift {
  readonly frames: number;
  /**
   * The label's own digits read directly at the nominal rate —
   * `H*3600 + M*60 + S + F/nominalRate` — ignoring drop-frame accounting and
   * pull-down entirely. This is what a person reading the numbers off the
   * display, rather than counting frames, believes the duration to be.
   */
  readonly nominalSeconds: number;
  /** Real elapsed time for those frames — see `timecodeSeconds`. */
  readonly realSeconds: number;
  /**
   * `realSeconds - nominalSeconds`. Positive means real time runs LONGER than
   * the label claims (29.97 NDF: +3.6 s over a labelled hour, because playing
   * 108000 frames at the true 30000/1001 rate takes 3603.6 s of real time).
   * Negative means real time runs shorter (29.97 DF: -3.6 ms over a labelled
   * hour — the two skipped labels per minute do not remove quite enough
   * frames to close the gap exactly, which is the residual DF is known for).
   */
  readonly driftSeconds: number;
}

/**
 * The wall-clock drift a timecode LABEL accumulates against its own digits.
 *
 * **A label is not the same quantity as the frame count it names.** NDF counts
 * real 30000/1001 fps frames but reads them as if the rate were exactly 30, so
 * an hour of real recording reads as more than an hour of label; DF corrects
 * the label back close to real time by skipping label numbers, but not
 * perfectly, leaving the millisecond residual above. `timecodeSeconds` alone
 * answers only the real-time half of that comparison — this pairs it with the
 * label's own naive reading so the drift itself is a number the tool hands
 * back, not one every surface has to re-derive from the two other functions.
 */
export function timecodeDrift(
  parts: TimecodeParts,
  format: TimecodeFormat,
): ProResult<TimecodeDrift> {
  const converted = timecodeToFrames(parts, format);
  if (!converted.ok) return converted;
  const real = timecodeSeconds(converted.frames, format);
  if (!real.ok) return real;
  const nominalSeconds =
    parts.hours * 3600 + parts.minutes * 60 + parts.seconds + parts.frames / format.nominalRate;
  return {
    ok: true,
    frames: converted.frames,
    nominalSeconds,
    realSeconds: real.seconds,
    driftSeconds: real.seconds - nominalSeconds,
  };
}

/* --------------------------------------------------------- timelapse planner -- */

export interface TimelapseInput {
  /** Interval between frames, in seconds. */
  readonly interval: number;
  readonly timelineFps: number;
  /** Exactly ONE of these three is given; the other two are computed from it. */
  readonly clipLength?: number | undefined;
  readonly shootingDuration?: number | undefined;
  readonly frameCount?: number | undefined;
  /** Shutter time per frame, in seconds. Optional, and only ever compared. */
  readonly shutter?: number | undefined;
}

export interface TimelapsePlan {
  readonly frameCount: number;
  /** First shutter to last shutter, in seconds. */
  readonly shootingDuration: number;
  readonly clipLength: number;
  /** i*fps — how many times real time the finished clip runs. */
  readonly speedUpFactor: number;
  /** shutter/interval, or undefined when no shutter was given. Above 1 means t > i. */
  readonly shutterOverIntervalRatio: number | undefined;
}

/**
 * The four numbers of a timelapse, from whichever one is known.
 *
 * **N frames at interval i span (N - 1) intervals, not N.** That fencepost is
 * the error the scrap-of-paper version makes: 1441 frames every 10 s is four
 * hours exactly, and 1440 would be ten seconds short. It is stated on the
 * surface because a user who measured it differently needs to know which
 * convention produced the number.
 *
 * A clip length that does not land on a whole frame is rounded to the nearest
 * frame and the exact length for THAT count is reported back, so the frame count
 * and the length on screen always agree.
 */
export function timelapsePlan(input: TimelapseInput): ProResult<TimelapsePlan> {
  const timelineFps = exactFrameRate(input.timelineFps);
  if (!isInRange(input.interval, 0.05, 86400)) return fail("interval");
  // Same band frameRateConform uses for the same quantity — a rate is a rate
  // regardless of which tool in the file is asking about it, and an unbounded
  // one lets a clip-length input silently produce a frame count no later check
  // was written to catch (see the isIntegerIn bounds on `frames` below).
  if (!isInRange(timelineFps, 0.1, 10000)) return fail("timelineFps");
  const { clipLength, shootingDuration, frameCount } = input;
  // Exactly one is GIVEN: any one of the three fixes the other two, so a second
  // one would over-determine the plan and could contradict it.
  if (definedCount(clipLength, shootingDuration, frameCount) !== 1) return fail("target");
  const shutter = input.shutter;
  if (shutter !== undefined && !isInRange(shutter, 1e-6, 3600)) return fail("shutter");

  let frames: number;
  if (frameCount !== undefined) {
    if (!isIntegerIn(frameCount, 1, 1000000)) return fail("frameCount");
    frames = frameCount;
  } else if (clipLength !== undefined) {
    if (!isInRange(clipLength, 0.04, 86400)) return fail("clipLength");
    frames = Math.round(clipLength * timelineFps);
    // The typed frameCount above is bound to 1..1000000; a count DERIVED from a
    // clip length owes the plan the same ceiling, or the two entry points into
    // the same field disagree about what a valid frame count is.
    if (!isIntegerIn(frames, 1, 1000000)) return fail("clipLength");
  } else if (shootingDuration !== undefined) {
    if (!isInRange(shootingDuration, 1, 8640000)) return fail("shootingDuration");
    // floorSnapped: shootingDuration/interval is a count of whole intervals
    // (the fencepost +1 turns it into a frame count), and a user-typed interval
    // like 0.1 s is exactly the divisor that lands one ULP under a whole number.
    frames = floorSnapped(shootingDuration / input.interval) + 1;
    if (!isIntegerIn(frames, 1, 1000000)) return fail("shootingDuration");
  } else {
    return fail("target");
  }

  return {
    ok: true,
    frameCount: frames,
    shootingDuration: (frames - 1) * input.interval,
    clipLength: frames / timelineFps,
    speedUpFactor: input.interval * timelineFps,
    shutterOverIntervalRatio:
      shutter === undefined ? undefined : ratioAgainst(shutter, input.interval),
  };
}

/* ------------------------------------------------- video bitrate and storage -- */

export interface VideoStorageInput {
  readonly videoBitrateMbps: number;
  /** Audio bitrate in Mbit/s, added to the video's. Absent means no audio track. */
  readonly audioBitrateMbps?: number | undefined;
  /** Exactly ONE of these three is given; it decides which question is asked. */
  readonly duration?: number | undefined;
  readonly size?: { readonly value: number; readonly unit: CapacityUnit } | undefined;
  /** Card or disk capacity in GB AS LABELLED — card labels are decimal, 10^9 B. */
  readonly capacityGb?: number | undefined;
  /** Number of cards or copies; absent means one. */
  readonly cardCount?: number | undefined;
}

export interface VideoStorage {
  readonly totalBitrateMbps: number;
  /** Recording duration, in seconds. */
  readonly duration: number;
  readonly bytes: number;
  readonly gigabytes: number;
  readonly gibibytes: number;
  /** Recordable seconds on one card; defined only when a capacity was given. */
  readonly recordableSecondsPerCard: number | undefined;
  readonly recordableSecondsTotal: number | undefined;
}

/**
 * Bitrate, duration and file size, and how much recording a card holds.
 *
 * **Both byte conventions come back together.** A 128 GB card is 128*10^9 bytes
 * on the label and 119.2 GiB in the operating system, and the tool prints both
 * rather than picking the flattering one — that gap is the single most common
 * „my card is smaller than advertised" complaint and it is arithmetic, not a
 * defect.
 *
 * This is pure bitrate arithmetic: it does not model container overhead and a
 * variable bitrate is by definition not one number.
 */
export function videoStorage(input: VideoStorageInput): ProResult<VideoStorage> {
  if (!isInRange(input.videoBitrateMbps, 0.01, 20000)) return fail("videoBitrateMbps");
  const audio = input.audioBitrateMbps;
  if (audio !== undefined && !isInRange(audio, 0, 100)) return fail("audioBitrateMbps");
  const cardCount = input.cardCount;
  if (cardCount !== undefined && !isIntegerIn(cardCount, 1, 1000)) return fail("cardCount");
  const { duration, size, capacityGb } = input;
  // Exactly one is GIVEN: duration and size are the same fact through the
  // bitrate, and a capacity asks the third question — how long a card lasts.
  if (definedCount(duration, capacityGb) + (size === undefined ? 0 : 1) !== 1) {
    return fail("target");
  }

  const totalBitrateMbps = input.videoBitrateMbps + (audio ?? 0);
  const bitsPerSecond = totalBitrateMbps * 1e6;
  if (!isPositive(bitsPerSecond)) return fail("videoBitrateMbps");

  let bytes: number;
  let seconds: number;
  let perCard: number | undefined;
  if (duration !== undefined) {
    if (!isInRange(duration, 0.04, 864000)) return fail("duration");
    seconds = duration;
    bytes = (bitsPerSecond * seconds) / BITS_PER_BYTE;
  } else if (size !== undefined) {
    if (!isInRange(size.value, 0.000001, 1000000)) return fail("size");
    bytes = capacityBytesOf(size);
    seconds = (bytes * BITS_PER_BYTE) / bitsPerSecond;
  } else if (capacityGb !== undefined) {
    if (!isInRange(capacityGb, 0.001, 1000000)) return fail("capacityGb");
    bytes = capacityGb * BYTES_PER_GB;
    seconds = (bytes * BITS_PER_BYTE) / bitsPerSecond;
    perCard = seconds;
  } else {
    return fail("target");
  }

  return {
    ok: true,
    totalBitrateMbps,
    duration: seconds,
    bytes,
    gigabytes: bytes / BYTES_PER_GB,
    gibibytes: bytes / BYTES_PER_GIB,
    recordableSecondsPerCard: perCard,
    recordableSecondsTotal: perCard === undefined ? undefined : perCard * (cardCount ?? 1),
  };
}
