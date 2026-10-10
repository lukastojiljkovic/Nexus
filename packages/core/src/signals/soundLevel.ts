/**
 * Sound meter — levels of a frame, weighted the way a meter weights them.
 *
 * **Everything here is relative, and every name says so.** A computer
 * microphone has no calibration: its sensitivity is a different number per
 * laptop, per driver and per gain setting, and it is not written anywhere the
 * software can read. So this module reports **dBFS** — decibels relative to
 * digital full scale — and offers exactly one conversion, `splFromDbfs`, whose
 * only input is an offset the USER measured against a reference. No function
 * here returns a number called dB SPL, and none takes a microphone sensitivity:
 * a claim of dB SPL without the user's own offset is a fabricated measurement,
 * and it would be a different fabricated number on the next machine.
 *
 * **A full-scale sine reads −3.01 dBFS RMS.** RMS of a sine of amplitude 1 is
 * 1/√2, and 20·log₁₀(1/√2) = −3.0103. That single number is the whole
 * calibration of this file and it is asserted in its tests.
 *
 * **A-weighting is derived from the standard, not tabulated.** IEC 61672-1
 * defines the weighting as an ANALOG transfer function — the poles and zeros
 * below — so the digital filter this module ships cannot be a table of numbers
 * copied off a datasheet, whose sample rate would then be a hidden assumption.
 * The analogue definition is bilinear-transformed to a digital biquad cascade
 * at the caller's sample rate, and the result is checked against the standard's
 * own nominal table in `soundLevel.test.ts`. The exact analogue response is
 * exported beside the digital filter (`aWeightingDb`), so the two can be told
 * apart — one is the definition, the other is what can run on samples.
 */

/** One second-order section, Direct Form I: `y = (b0 x + b1 x₁ + b2 x₂ − a1 y₁ − a2 y₂)`. */
export interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** A digital A-weighting filter: the sections to apply, in order, at the rate they were designed for. */
export interface AWeightingFilter {
  /** The rate the sections were designed at. Applying them at another is a different filter. */
  readonly sampleRate: number;
  readonly sections: readonly Biquad[];
}

/** A level reading of one frame. */
export interface FrameLevel {
  /** RMS of the frame, in dBFS. −120 for digital silence, which is a floor and not a measurement. */
  readonly rmsDb: number;
  /** Largest absolute sample, in dBFS. */
  readonly peakDb: number;
  /** Peak minus RMS: how much the frame's envelope moves. 3.01 for a steady sine. */
  readonly crestDb: number;
}

/**
 * The floor this module reports for digital silence. It is not „the level of
 * silence": it is the smallest number a level display is worth printing, a hair
 * under the −96 dBFS of 16-bit dither noise, and it exists so that every
 * arithmetic path returns a finite number.
 */
export const SILENCE_FLOOR_DB = -120;

/**
 * Frames quieter than this are not analysed for pitch. −60 dBFS is a quiet room
 * through a laptop microphone — audible, but far enough above the noise floor
 * that a periodicity reading on it would be reading the microphone's own hiss.
 */
export const DEFAULT_LEVEL_GATE_DB = -60;

/** RMS of a frame, in linear amplitude. Zero for an empty frame. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] as number;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

/** Largest absolute sample, in linear amplitude. Zero for an empty frame. */
export function peak(samples: Float32Array): number {
  let largest = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index] as number);
    if (value > largest) largest = value;
  }
  return largest;
}

/**
 * A linear amplitude as dBFS, floored at `SILENCE_FLOOR_DB`.
 *
 * Amplitude ratios are 20·log₁₀, not 10·log₁₀: a factor of two in amplitude is
 * 6.02 dB, not 3.01. The power form belongs on power, and the half-step between
 * the two is the most common arithmetic error in a level meter.
 */
export function dBfsFromAmplitude(amplitude: number): number {
  if (!(amplitude > 0) || !Number.isFinite(amplitude)) return SILENCE_FLOOR_DB;
  return Math.max(SILENCE_FLOOR_DB, 20 * Math.log10(amplitude));
}

/** RMS amplitude as dBFS. */
export function dBfsFromRms(value: number): number {
  return dBfsFromAmplitude(value);
}

/** Peak amplitude as dBFS. */
export function dBfsFromPeak(value: number): number {
  return dBfsFromAmplitude(value);
}

/** The linear amplitude `dB` dBFS stands for, and the inverse of `dBfsFromAmplitude` above the floor. */
export function amplitudeFromDbfs(dB: number): number {
  return dB <= SILENCE_FLOOR_DB ? 0 : 10 ** (dB / 20);
}

/**
 * A frame's RMS, peak and crest factor, all in dBFS.
 *
 * Crest factor is the one number here that is not a level: it is the shape of
 * the frame, and it is what tells a steady tone (3.01 dB) from speech (10 dB or
 * more) without the user knowing either level.
 */
export function frameLevel(samples: Float32Array): FrameLevel {
  const rmsDb = dBfsFromRms(rms(samples));
  const peakDb = dBfsFromPeak(peak(samples));
  return { rmsDb, peakDb, crestDb: peakDb - rmsDb };
}

/**
 * Leq over a window — the equivalent steady level with the same energy.
 *
 * A window is a list of frames' RMS values, in linear amplitude, which is what
 * `rms` returns and what a caller accumulates as it reads frames: the energy
 * average is the mean of the squares, so the frames do not have to be summed in
 * any order and a frame that arrives twice counts twice — which is the correct
 * treatment of a window that got longer, and the reason the accumulator below
 * exists instead of a running mean of dB values. Averaging dB is averaging
 * logarithms; it under-reports every window that contains a loud moment.
 */
export function leqFromFrameRms(frameRms: readonly number[]): number {
  if (frameRms.length === 0) return SILENCE_FLOOR_DB;
  let sum = 0;
  for (const value of frameRms) sum += value > 0 ? value * value : 0;
  return dBfsFromRms(Math.sqrt(sum / frameRms.length));
}

/** Leq of a window given its frames' levels in dBFS. */
export function leqFromFrameLevels(frameLevelsDb: readonly number[]): number {
  return leqFromFrameRms(frameLevelsDb.map(amplitudeFromDbfs));
}

/**
 * A running Leq over one window, frame by frame.
 *
 * Feed it frames as they arrive and read `leqDb` whenever the display redraws.
 * The squares are kept as a sum rather than as a list, so a window's memory is
 * one number; `reset()` starts a new window, which is what the user's „reset"
 * does and what a rolling display does on a timer.
 */
export class LeqWindow {
  #sum = 0;
  #frames = 0;

  /**
   * Push one frame's RMS, in linear amplitude.
   *
   * A frame of digital silence is `0` and is COUNTED — it is a measurement of
   * nothing, which is what a quiet room is — exactly as `leqFromFrameRms` counts
   * it. The first version refused `value <= 0` along with the values that are not
   * levels at all, so a window that went quiet kept reporting its last loud
   * second; what may be refused is a value that is not a level (negative,
   * `NaN`, infinite), never a quiet one.
   */
  addFrameRms(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.#sum += value * value;
    this.#frames += 1;
  }

  /** Push one frame of samples. */
  addFrame(samples: Float32Array): void {
    this.addFrameRms(rms(samples));
  }

  /** The window's Leq, in dBFS. Digital silence while no frame has been added. */
  get leqDb(): number {
    return this.#frames === 0 ? SILENCE_FLOOR_DB : dBfsFromRms(Math.sqrt(this.#sum / this.#frames));
  }

  /** How many frames the current window holds. */
  get frameCount(): number {
    return this.#frames;
  }

  /** Drop the window and start again. */
  reset(): void {
    this.#sum = 0;
    this.#frames = 0;
  }
}

/**
 * dB SPL from a dBFS reading and the user's own calibration offset.
 *
 * The offset is the one number that turns a relative level into an absolute
 * one, and it is measured, never assumed: the user holds a reference source of
 * known level (a calibrator, or another meter beside the laptop) in front of
 * the microphone, reads this module's dBFS figure, and the offset is the
 * difference. It is stored per device and per input, because it is a fact about
 * one microphone at one gain.
 *
 * The name of the result says „splFromDbfs" and not „spl": there is no path in
 * this module that produces an SPL without the caller passing an offset in.
 */
export function splFromDbfs(rmsDb: number, calibrationOffsetDb: number): number | null {
  if (!Number.isFinite(rmsDb) || !Number.isFinite(calibrationOffsetDb)) return null;
  return rmsDb + calibrationOffsetDb;
}

/**
 * The A-weighting gain in dB at any frequency — the STANDARD'S definition,
 * evaluated.
 *
 * The expression is IEC 61672-1's:
 *
 *     R_A(f) = f₄² · f⁴ /
 *       ( (f² + f₁²) · √((f² + f₂²)(f² + f₃²)) · (f² + f₄²) )
 *     A(f)   = 20 log₁₀( R_A(f) / R_A(1000) )
 *
 * with f₁ = 20.598997, f₂ = 107.65265, f₃ = 737.86223 and f₄ = 12194.217 Hz.
 * **Only the 107.7 Hz and 737.9 Hz terms belong under the square root**: those
 * two poles are single, while 20.6 Hz and 12194 Hz are DOUBLE poles — the pair
 * the numerator's `f₄²` and the `(f² + f₁²)` and `(f² + f₄²)` factors carry.
 * Putting all four terms under the root is a different function, and it is
 * invisible at 1 kHz, where the ratio to `R_A(1000)` is 1 whatever the shape
 * does and the normalisation pins the answer: it answers −39.0 dB at 100 Hz
 * where the standard says −19.1.
 *
 * The two zeros are at 0 Hz and at infinity, which is why the numerator is `f⁴`.
 * Every frequency here is a plain one in Hz, and so is every pole: the ratio to
 * `R_A(1000)` cancels `f₄²` and every other constant, so there is no unit in the
 * expression for a factor to go missing from.
 *
 * This is a REFERENCE, and it is what the tests check the digital filter
 * against. The digital filter is the one that can run on samples.
 */
export function aWeightingDb(frequencyHz: number): number {
  if (!(frequencyHz > 0) || !Number.isFinite(frequencyHz)) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(aWeightingShape(frequencyHz) / aWeightingShape(A_WEIGHTING_REFERENCE_HZ));
}

/**
 * The un-normalised shape of the weighting, `R_A` above, in plain Hz.
 *
 * The square root holds `(f² + f₂²)(f² + f₃²)` — the two single poles — and
 * nothing else. The double poles at 20.6 Hz and 12194 Hz are the unrooted
 * factors beside it, `(f² + f₁²)` and `(f² + f₄²)`.
 */
function aWeightingShape(frequencyHz: number): number {
  const squared = frequencyHz ** 2;
  const [f1, f2, f3, f4] = A_WEIGHTING_POLES;
  return (
    (f4 ** 2 * squared ** 2) /
    ((squared + f1 ** 2) * Math.sqrt((squared + f2 ** 2) * (squared + f3 ** 2)) * (squared + f4 ** 2))
  );
}

/**
 * The poles of the analogue definition, in Hz, in the order the sections use
 * them: 20.6 Hz twice, 107.7 and 737.9 Hz once each, 12194 Hz twice. Plain
 * frequencies, because `aWeightingShape` is written in plain ones;
 * `designAWeighting` is the one that needs them angular and converts them
 * there.
 */
const A_WEIGHTING_POLES = [20.598997, 107.65265, 737.86223, 12194.217] as const;

/**
 * Where the bilinear transform's gain is pinned. It is 1 kHz because the
 * standard defines the weighting to be 0 dB there, so pinning anywhere else
 * would make the filter disagree with `aWeightingDb` by the difference between
 * the two points.
 */
const A_WEIGHTING_REFERENCE_HZ = 1000;

/**
 * A digital A-weighting filter for a sample rate.
 *
 * The standard's prototype has six poles — 20.6 Hz twice, 107.7 Hz, 737.9 Hz
 * and 12194 Hz twice — and four zeros, all at 0 Hz. The cascade below is that
 * shape and no other: `(s/(s + ω₁))²` for the double pole at 20.6 Hz,
 * `s/(s + ω₂) · s/(s + ω₃)` for the two single ones, and `(ω₄/(s + ω₄))²` for
 * the double pole at 12194 Hz, each bilinear-transformed and normalised with
 * `a0 = 1`. Their product is the prototype's `s⁴` over its own six poles, so the
 * four zeros land at 0 Hz, where the prototype puts them.
 *
 * The map is `s = K(1 − z⁻¹)/(1 + z⁻¹)` with `K = 2·fs` and `ωᵢ = 2π·fᵢ`, with no
 * pre-warping; the first section's numerator is then scaled so the cascade is
 * exactly 0 dB at 1 kHz, where the standard defines the weighting to be unity.
 *
 * **The price of that map is at the top of the band, and it is the meter's
 * behaviour there.** With no pre-warp the map links the analogue and digital
 * frequency axes at 0 Hz and nowhere else, so the cascade's response at a
 * digital frequency `f` is the prototype's response at `2·fs·tan(π·f/fs)/2π` —
 * a frequency above `f`, further above it the closer `f` comes to Nyquist,
 * where the weighting is falling. The cascade is therefore BELOW
 * `aWeightingDb` across the top: measured against it, 0.27 dB low at 6.3 kHz and
 * 1.50 dB low at 10 kHz at 44.1 kHz, 0.54 dB low at 8 kHz and 1.22 dB low at
 * 10 kHz at 48 kHz, and 0.31 and 0.26 dB low at 10 kHz at 88.2 and 96 kHz.
 * **This is why the meter reads the top octave low at 44.1 and 48 kHz** — the
 * rates a laptop microphone normally runs at — and why the same reading at
 * 96 kHz is nearly right. The tests pin the deviation at 10 kHz at all four
 * rates so it cannot drift unnoticed.
 *
 * Throws below 44.1 kHz. The highest pole is at 12.2 kHz, so the four rates
 * this design is meant for — 44.1, 48, 88.2 and 96 kHz — all put it well inside
 * Nyquist; a rate low enough to leave the checked range behind is refused
 * rather than answered with a filter nobody has measured.
 */
export function designAWeighting(sampleRate: number): AWeightingFilter {
  if (!Number.isFinite(sampleRate) || sampleRate < 44_100) {
    throw new RangeError(`sampleRate ${sampleRate} must be at least 44100 for this design`);
  }
  // K is the map's own scale, and `2·fs` is what makes it the same unit as the
  // ωᵢ below. A section whose numerator has lost its K is the one error here the
  // normalisation cannot catch: the 1 kHz gain is measured off the same
  // sections, so it moves with them and pins the wrong filter exactly.
  const k = 2 * sampleRate;
  const [f1, f2, f3, f4] = A_WEIGHTING_POLES;
  const omega1 = 2 * Math.PI * f1;
  const omega2 = 2 * Math.PI * f2;
  const omega3 = 2 * Math.PI * f3;
  const omega4 = 2 * Math.PI * f4;
  // Section 1, `(s/(s + ω₁))²` — the double pole at 20.6 Hz. One first-order
  // factor maps to `K(1 − z⁻¹)/((K + ω₁) − (K − ω₁)z⁻¹)`, and squaring it
  // squares both parts, so the denominator's coefficients are one root's
  // multiplied by themselves: `a1` is twice that root and `a2` is its square,
  // which is what a repeated pole looks like and not what a pair of them does.
  const denominator1 = (k + omega1) ** 2;
  const section1: Biquad = {
    b0: k ** 2 / denominator1,
    b1: (-2 * k ** 2) / denominator1,
    b2: k ** 2 / denominator1,
    a1: (-2 * (k - omega1)) / (k + omega1),
    a2: ((k - omega1) / (k + omega1)) ** 2,
  };
  // Section 2, `s/(s + ω₂) · s/(s + ω₃)` — the single poles at 107.7 and 737.9
  // Hz. Two DIFFERENT first-order factors, so the denominator is their product
  // written out and `a1` is the sum of their two roots rather than twice one of
  // them.
  const denominator2 = (k + omega2) * (k + omega3);
  const section2: Biquad = {
    b0: k ** 2 / denominator2,
    b1: (-2 * k ** 2) / denominator2,
    b2: k ** 2 / denominator2,
    a1: -((k - omega2) / (k + omega2) + (k - omega3) / (k + omega3)),
    a2: ((k - omega2) * (k - omega3)) / denominator2,
  };
  // Section 3, `(ω₄/(s + ω₄))²` — the double pole at 12194 Hz, and the one
  // section with no zero at 0 Hz: its numerator is a constant, whose image is
  // `(1 + z⁻¹)²` where the other two carry `(1 − z⁻¹)²`.
  const denominator4 = (k + omega4) ** 2;
  const section3: Biquad = {
    b0: omega4 ** 2 / denominator4,
    b1: (2 * omega4 ** 2) / denominator4,
    b2: omega4 ** 2 / denominator4,
    a1: (-2 * (k - omega4)) / (k + omega4),
    a2: ((k - omega4) / (k + omega4)) ** 2,
  };
  // Pin the cascade at the standard's own reference. The gain is measured off
  // the sections themselves rather than carried as a constant, so it cannot be
  // wrong by a power of ten, and what it pins is the property the standard
  // defines the weighting by: exactly 0 dB at 1 kHz.
  const sections: readonly [Biquad, Biquad, Biquad] = [section1, section2, section3];
  const gain = 10 ** (-biquadCascadeDb(sections, A_WEIGHTING_REFERENCE_HZ, sampleRate) / 20);
  return {
    sampleRate,
    // The scale goes on the first section's numerator alone: a cascade's gain is
    // the product of its sections', so scaling all three would apply it three
    // times over.
    sections: [
      { ...section1, b0: section1.b0 * gain, b1: section1.b1 * gain, b2: section1.b2 * gain },
      section2,
      section3,
    ],
  };
}

/**
 * The gain of a biquad cascade in dB at a frequency — the digital response,
 * which is what `designAWeighting` is checked against the standard with.
 */
export function biquadCascadeDb(sections: readonly Biquad[], frequencyHz: number, sampleRate: number): number {
  if (!(frequencyHz > 0) || frequencyHz >= sampleRate / 2) return Number.NEGATIVE_INFINITY;
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  // z⁻¹ on the unit circle.
  const z1 = { re: Math.cos(omega), im: -Math.sin(omega) };
  const z2 = { re: Math.cos(2 * omega), im: -Math.sin(2 * omega) };
  let gain = 1;
  for (const section of sections) {
    const numerator = {
      re: section.b0 + section.b1 * z1.re + section.b2 * z2.re,
      im: section.b1 * z1.im + section.b2 * z2.im,
    };
    const denominator = {
      re: 1 + section.a1 * z1.re + section.a2 * z2.re,
      im: section.a1 * z1.im + section.a2 * z2.im,
    };
    const numeratorMagnitude = Math.hypot(numerator.re, numerator.im);
    const denominatorMagnitude = Math.hypot(denominator.re, denominator.im);
    gain *= denominatorMagnitude === 0 ? Number.POSITIVE_INFINITY : numeratorMagnitude / denominatorMagnitude;
  }
  return 20 * Math.log10(gain);
}

/**
 * A-weight the samples: a new array of the same length, the filter's sections
 * applied in order.
 *
 * **Each section runs on its own state.** A section's `x₁`, `x₂`, `y₁` and `y₂`
 * are the history of what was fed to THAT section, so one set of variables
 * shared across a cascade does not compute a cascade — the second section's
 * feedback would land in the first section's input, and the result is neither
 * the product of the sections nor the filter `designAWeighting` normalised. The
 * frame is worked in place between sections, which is safe because Direct Form I
 * reads the input at `index` before writing the output there, and it is why the
 * whole cascade costs one buffer and allocates nothing per section.
 */
export function applyAWeighting(samples: Float32Array, filter: AWeightingFilter): Float32Array {
  const output = new Float32Array(samples.length);
  output.set(samples);
  for (const section of filter.sections) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let index = 0; index < output.length; index += 1) {
      const x = output[index] as number;
      const y = section.b0 * x + section.b1 * x1 + section.b2 * x2 - section.a1 * y1 - section.a2 * y2;
      output[index] = y;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
    }
  }
  return output;
}
