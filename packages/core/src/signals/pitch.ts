/**
 * Pitch detection — YIN, with the parity and the interpolation that make it
 * accurate enough to tune an instrument to.
 *
 * The algorithm is de Cheveigné and Kawahara, „YIN, a fundamental frequency
 * estimator for speech and music", J. Acoust. Soc. Am. 111(4), 2002. Step by
 * step, over a frame `x[0…n-1]`:
 *
 * 1. the difference function `d[τ] = Σⱼ (x[j] − x[j+τ])²`;
 * 2. its cumulative mean normalisation `d'[τ] = d[τ] / ((1/τ) Σ d[1…τ])`, which
 *    is what makes the estimator independent of the signal's level and of how
 *    far into the frame the period is;
 * 3. the first local minimum of `d'` below the algorithm's own absolute
 *    threshold, searched from a lag of `sampleRate / maxHz` rather than from 1
 *    — searching from 1 finds a minimum at the first lag where the normaliser
 *    is still noisy. The clarity that minimum implies is what the caller's
 *    `clarityThreshold` then accepts or refuses;
 * 4. parabolic interpolation of that minimum with its two neighbours.
 *
 * **Step 4 is not optional here.** A period of 48.0 samples at 48 kHz is a
 * 1000 Hz tone, and an integer lag of 48 is where the minimum sits only when
 * the tone happens to land there; half a sample of lag error is 1 % of the
 * period, which is 18 cents — an instrument tuner that is visibly wrong on the
 * high strings. Interpolating the minimum brings that to 0.22 cents at worst
 * across E2…1 kHz and under a hundredth of a cent at C4 and below, which is
 * what `pitch.test.ts` measures.
 *
 * The difference function is the exact sum, `d[τ] = Σⱼ (x[j] − x[j+τ])²`, over
 * the FIRST HALF of the frame, with the second half read as the lag's tail:
 * every lag then sums the same number of pairs, which is what step 2's
 * normalisation assumes, and the minimum at the true period reaches zero on a
 * clean tone. The cheaper-looking form that fits entirely inside one frame —
 * `Σx² − 2·Σx[j]x[j+τ] + Σx[j+τ]²` — compares the frame against itself with
 * zeroes past its end and leaves a residual of `τ/2` in `d[τ]`, which floors
 * `d′` at `τ / (2·window)`: 0.14 for the guitar's low E in a 2048-sample frame,
 * above the 0.1 threshold, so that note is not found at all — and where the
 * minimum is found anyway, the residual's tilt moves the interpolated vertex by
 * nearly a sample, which at 932 Hz is 31 cents. One loop per lag, `O(n·τmax)`,
 * with no allocation inside it, costs no more per pair than that form did.
 */

import { dBfsFromRms, rms, DEFAULT_LEVEL_GATE_DB } from "./soundLevel.js";

/** What a detection found, or why it found nothing. */
export interface PitchDetection {
  /** The fundamental in Hz, or null when there was no pitch to report. */
  readonly frequencyHz: number | null;
  /**
   * YIN's periodicity confidence: 1 is perfectly periodic, 0 is nothing but.
   * This is `1 − d'[τ*]`, so it is comparable across frames.
   */
  readonly clarity: number;
  /** Level of the frame in dBFS, reported whether or not a pitch was found. */
  readonly levelDb: number;
  /** True when the frame was too quiet to judge — the level gate refused it. */
  readonly gated: boolean;
}

export interface PitchDetectionOptions {
  /**
   * Below this CLARITY there is no pitch. YIN's own published threshold is an
   * absolute one of 0.1 on its aperiodicity `d′` — and `clarity` is `1 − d′`,
   * so the same rule on this scale is 0.9, which is the default: a frame must
   * be 90 % periodic to be reported at all. A caller may raise or lower it, and
   * the reading is measured first, so the clarity comes back with the refusal.
   */
  readonly clarityThreshold?: number;
  /** Frames quieter than this are not judged at all, in dBFS. */
  readonly levelGateDb?: number;
  /** The lowest fundamental to consider, in Hz. Also fixes the first lag tried. */
  readonly minHz?: number;
  /** The highest fundamental to consider, in Hz. */
  readonly maxHz?: number;
}

export interface PitchOptions extends PitchDetectionOptions {
  readonly sampleRate: number;
}

export const DEFAULT_MIN_HZ = 40;
export const DEFAULT_MAX_HZ = 2000;
export const DEFAULT_CLARITY = 0.9;
/**
 * The shortest frame YIN can read a period from. Half of it is the analysis
 * window and the other half the lag's tail, so at 48 kHz a frame this short
 * cannot reach below 375 Hz — a caller wanting a guitar's low E sizes its frame
 * for that, and the engine answers „no pitch" rather than a guess below
 * whatever it can see.
 */
export const MIN_FRAME_SAMPLES = 256;

/**
 * The fundamental of a frame, or null.
 *
 * The window YIN analyses is the first half of `samples`; the second half is
 * the correlation tail. A frame shorter than `2 / minHz` seconds has no period
 * to find, so the caller must size the frame for the range it wants, and the
 * engine returns „no pitch" rather than a guess when it cannot.
 */
export function detectPitch(samples: Float32Array, options: PitchOptions): PitchDetection {
  const { sampleRate } = options;
  const clarityThreshold = options.clarityThreshold ?? DEFAULT_CLARITY;
  const levelGateDb = options.levelGateDb ?? DEFAULT_LEVEL_GATE_DB;
  const minHz = options.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = options.maxHz ?? DEFAULT_MAX_HZ;

  const level = samples.length === 0 ? Number.NEGATIVE_INFINITY : dBfsFromRms(rms(samples));
  const gated = level < levelGateDb;
  if (gated || !Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length < MIN_FRAME_SAMPLES) {
    return { frequencyHz: null, clarity: 0, levelDb: level, gated };
  }

  const window = samples.length >> 1;
  const maxLag = Math.min(window, Math.floor(sampleRate / minHz));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxLag <= minLag) return { frequencyHz: null, clarity: 0, levelDb: level, gated };

  const difference = yinDifference(samples, window, maxLag);
  const normalised = yinCumulativeMean(difference, minLag);
  const tau = yinFirstMinimum(normalised, minLag, maxLag, YIN_ABSOLUTE_THRESHOLD);
  if (tau < 0) return { frequencyHz: null, clarity: 0, levelDb: level, gated };

  const refined = parabolicMinimum(normalised, tau);
  const clarity = 1 - (normalised[tau] as number);
  // The caller's threshold is in CLARITY and YIN's search threshold above is in
  // `d′`; they are the same rule read on two scales, and the reading is measured
  // before it is refused so a needle can be shown fading rather than blinking.
  if (clarity < clarityThreshold) return { frequencyHz: null, clarity, levelDb: level, gated };
  return {
    frequencyHz: sampleRate / refined,
    clarity,
    levelDb: level,
    gated,
  };
}

/**
 * `d[τ]` for τ in `1…maxLag`: the first half of the frame against itself
 * shifted by τ.
 *
 * Every lag sums the same `window` pairs — the first half of the frame against
 * the same window shifted by τ — so the sum needs no normalisation over the
 * number of terms, and `τmax` can be at most `window` because the shift has to
 * stay inside the frame. The samples past the window are the tail this reads;
 * nothing is padded with zeroes.
 */
function yinDifference(samples: Float32Array, window: number, maxLag: number): Float64Array {
  const difference = new Float64Array(maxLag + 1);
  difference[0] = 0;
  for (let tau = 1; tau <= maxLag; tau += 1) {
    let sum = 0;
    for (let index = 0; index < window; index += 1) {
      const delta = (samples[index] as number) - (samples[index + tau] as number);
      sum += delta * delta;
    }
    difference[tau] = sum;
  }
  return difference;
}

/**
 * `d'[τ]`, the cumulative mean normalisation. Computed from `minLag` onward:
 * the first lags of a raw difference function are always near zero — the frame
 * against itself a sample later — and dividing by their mean is what produces
 * the spurious octave-high readings YIN's step 3 exists to avoid.
 */
function yinCumulativeMean(difference: Float64Array, minLag: number): Float64Array {
  const normalised = new Float64Array(difference.length);
  if (difference.length === 0) return normalised;
  normalised[0] = 1;
  let running = 0;
  for (let tau = 1; tau < difference.length; tau += 1) {
    running += difference[tau] as number;
    normalised[tau] = tau < minLag ? 1 : (difference[tau] as number) / (running / tau || 1);
  }
  return normalised;
}

/**
 * YIN's published absolute threshold, the one step 3 of the paper searches
 * with: a lag is a candidate only if `d′[τ]` is below it. It is NOT the
 * caller's `clarityThreshold`, which is the same rule written as
 * `1 − d′` and applied to the reading this finds.
 */
const YIN_ABSOLUTE_THRESHOLD = 0.1;

/**
 * The first τ whose d′ is below `threshold` and a local minimum, or −1.
 *
 * The local-minimum condition matters as much as the threshold: a plateau of
 * values below the threshold would otherwise be entered at its left edge, where
 * the interpolation below reads two neighbours that are higher on one side only
 * and moves the answer off the true minimum.
 */
function yinFirstMinimum(normalised: Float64Array, minLag: number, maxLag: number, threshold: number): number {
  for (let tau = minLag; tau < maxLag; tau += 1) {
    const value = normalised[tau] as number;
    if (value >= threshold) continue;
    if (value <= (normalised[tau - 1] as number) && value <= (normalised[tau + 1] as number)) return tau;
  }
  return -1;
}

/**
 * The sub-sample position of the minimum at `tau`, by the parabola through
 * `tau − 1`, `tau` and `tau + 1` — YIN's step 4. The vertex sits where the
 * parabola's derivative is zero, `tau − (after − before) / (2(before − 2·at +
 * after))`: the SIGN of that term is what puts the vertex on the side of `tau`
 * the two neighbours lean towards, and taking it the other way inverts the
 * correction — a clean tone then reads an octave-accurate but 30-cent-wrong
 * pitch, because the vertex lands as far on the wrong side as it should have
 * landed on the right one. The denominator is guarded because a flat spot makes
 * it zero, and the unrefined lag is then the answer.
 */
function parabolicMinimum(values: Float64Array, tau: number): number {
  const before = values[tau - 1] as number;
  const at = values[tau] as number;
  const after = values[tau + 1] as number;
  const denominator = 2 * (before - 2 * at + after);
  return denominator === 0 ? tau : tau - (after - before) / denominator;
}
