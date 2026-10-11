/**
 * The tone generator's arithmetic: the four periodic shapes, white noise and
 * pink noise, as functions of a PHASE rather than of a clock.
 *
 * **Why phase, and not time.** A wave that takes `t` seconds and a frequency has
 * to decide what happens when `t` is enormous, what a sweep means, and where the
 * period boundary is. A wave that takes a phase in TURNS has one job — a number
 * in, a sample out — and the caller is the only thing that knows about seconds.
 * The audio thread is that caller, and it advances the phase by
 * `frequency / sampleRate` per frame, which is also exactly what a sweep changes
 * per frame.
 *
 * **Exactness is the point of the tests, so nothing is approximated here.**
 * `sampleWave("sine", 0.25)` is `1`, `sampleWave("square", 0.5)` is `−1`, and
 * `sampleWave("sawtooth", 0.25)` is `−0.5`. Those are not approximations of a
 * waveform; they are the waveform, and a test that asserted "a number between
 * −1 and 1" would pass for a generator that emitted silence.
 *
 * **Noise is seeded, which is what makes it testable.** White noise is two
 * uniform draws minus one, from the same `createSeededRandom` stream every game
 * in this package draws from; pink noise is Paul Kellet's filter over that
 * stream, whose seven coefficients are the widely published ones and whose
 * first three outputs are pinned by a hand-computed test. A generator whose
 * noise cannot be reproduced is a generator whose noise cannot be tested at all,
 * and a spectrum with a −3 dB/octave slope is the one thing pink noise means.
 *
 * **Sample rate and frequency are bounded, not clamped.** A caller asking for
 * 10 MHz at 44.1 kHz is a caller with a bug, and the honest answer is a refusal
 * rather than a silent aliasing artefact that sounds like a different tone.
 */

import { createSeededRandom } from "../games/random.js";

/** The shapes the generator offers. Noise is not periodic, so it is not a `PhaseWave`. */
export const WAVE_KINDS = ["sine", "square", "triangle", "sawtooth", "white", "pink"] as const;
export type WaveKind = (typeof WAVE_KINDS)[number];

/** The four shapes that are a function of phase alone. */
export type PhaseWaveKind = Exclude<WaveKind, "white" | "pink">;

/** The lowest and highest frequency the generator will produce — the audible band with a little room at each end. */
export const MIN_FREQUENCY_HZ = 20;
export const MAX_FREQUENCY_HZ = 20_000;

/** The rates a caller may generate at: Web Audio's own ends of the range, and what a file could hold. */
export const MIN_SAMPLE_RATE = 8_000;
export const MAX_SAMPLE_RATE = 192_000;

/**
 * How many frames one call will render.
 *
 * A bound rather than a limit anybody meets: the page renders a few seconds at
 * most (an offline render for the file export), and a bound here is what keeps a
 * mistaken `frames` from allocating a gigabyte in the renderer.
 */
export const MAX_WAVE_FRAMES = 480_000;

/**
 * One sample of a periodic shape, for a phase in turns.
 *
 * The phase is taken modulo one turn, so a caller walking past the end of a
 * period gets the next period rather than a discontinuity — and a negative phase
 * (a sweep that starts below zero, a caller that stepped backwards) wraps
 * symmetrically rather than reflecting, which is what keeps a Lissajous figure
 * from tearing.
 *
 * The shapes are the textbook ones, chosen so that each starts at zero going up
 * except the triangle, which starts at −1 going up — the triangle's conventional
 * drawing is the full triangle, not its rising half.
 */
export function sampleWave(kind: PhaseWaveKind, phase: number): number {
  if (!Number.isFinite(phase)) throw new RangeError("A phase must be a finite number of turns.");
  const turn = phase - Math.floor(phase);
  switch (kind) {
    case "sine":
      return Math.sin(2 * Math.PI * turn);
    case "square":
      return turn < 0.5 ? 1 : -1;
    case "triangle":
      return 1 - 4 * Math.abs(turn - 0.5);
    case "sawtooth":
      return 2 * turn - 1;
  }
}

/**
 * Paul Kellet's pink-noise coefficients.
 *
 * Pink noise has equal energy per OCTAVE rather than per hertz; this filter
 * shapes white noise towards that −3 dB/octave slope with seven one-pole
 * sections, and the numbers are the ones the filter is published with. They are
 * stated here rather than inlined so a test can name them and a reader can see
 * that the shape is a decision rather than a transcription error.
 */
export const PINK_FILTER = {
  /** The seven section coefficients, in the order the state below feeds them. */
  coefficients: [0.99886, 0.99332, 0.969, 0.8665, 0.55, 0.7616, -0.7616],
  /** How much of each section's input the section sees — the published input gains. */
  inputs: [0.5362, 0.115926, 0.09685, 0.08504, 0.07037, 0.03459, 0.01931],
  /** The gain that brings the summed output back to roughly the white stream's own amplitude. */
  outputGain: 0.11,
} as const;

/** The filter's memory: seven one-pole sections. Plain data, so a caller can hold it and a test can read it. */
export interface PinkState {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
  s6: number;
}

/** A filter with nothing in it yet. */
export function newPinkState(): PinkState {
  return { s0: 0, s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, s6: 0 };
}

/**
 * One step of the pink filter, mutating `state` and answering the sample.
 *
 * Exported because the exactness of the first three outputs is what proves the
 * filter is the one it claims to be, and a test can only assert that if it can
 * hand the filter one known white sample at a time.
 */
export function pinkStep(state: PinkState, white: number): number {
  const c = PINK_FILTER.coefficients;
  const i = PINK_FILTER.inputs;
  state.s0 = c[0] * state.s0 + white * i[0];
  state.s1 = c[1] * state.s1 + state.s0 * i[1];
  state.s2 = c[2] * state.s2 + state.s1 * i[2];
  state.s3 = c[3] * state.s3 + state.s2 * i[3];
  state.s4 = c[4] * state.s4 + state.s3 * i[4];
  state.s5 = c[5] * state.s5 + state.s4 * i[5];
  state.s6 = c[6] * state.s6 + state.s5 * i[6];
  return (
    (state.s0 + state.s1 + state.s2 + state.s3 + state.s4 + state.s5 + state.s6) *
    PINK_FILTER.outputGain
  );
}

/** One frame of a modelled wave: the sample, and nothing else a caller has to advance. */
export interface RenderedWave {
  readonly kind: WaveKind;
  readonly sampleRate: number;
  readonly frequency: number;
  readonly samples: readonly number[];
}

/**
 * What `renderWave` is asked for.
 *
 * Two arms rather than one shape with an ignored field: noise has no frequency
 * and a periodic wave has no seed, and a request that carried both would let a
 * caller believe the frequency of a noise burst meant something.
 */
export type WaveRequest =
  | {
      readonly kind: PhaseWaveKind;
      readonly sampleRate: number;
      readonly frequency: number;
      readonly frames: number;
      /** Where the wave starts, in turns. A sweep continues from its previous end rather than restarting. */
      readonly fromPhase?: number;
    }
  | {
      readonly kind: "white" | "pink";
      readonly sampleRate: number;
      readonly frames: number;
      /** The noise stream's seed. Default 1, so two renders of one request are the same samples. */
      readonly seed?: number;
    };

/**
 * `frames` samples of one wave, starting at `fromPhase`.
 *
 * The samples are `−1…1` and are NOT scaled: level is the caller's business and
 * is where the ear-damage risk lives, so a constant in this file would be the
 * wrong place to hold it. The phase advances by `frequency / sampleRate` per
 * frame and is not re-derived from a frame index, so a caller that renders a
 * second's worth at a time gets a continuous wave across the join.
 */
export function renderWave(request: WaveRequest): RenderedWave {
  const { sampleRate, frames } = request;
  if (!Number.isFinite(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    throw new RangeError(`A sample rate must be ${MIN_SAMPLE_RATE}…${MAX_SAMPLE_RATE} Hz.`);
  }
  if (!Number.isInteger(frames) || frames < 0 || frames > MAX_WAVE_FRAMES) {
    throw new RangeError(`A frame count must be a whole number in 0…${MAX_WAVE_FRAMES}.`);
  }

  const samples: number[] = [];
  switch (request.kind) {
    case "white":
    case "pink": {
      const kind = request.kind;
      const random = createSeededRandom(request.seed ?? 1);
      const state = newPinkState();
      for (let frame = 0; frame < frames; frame += 1) {
        const white = random.next() * 2 - 1;
        samples.push(kind === "white" ? white : pinkStep(state, white));
      }
      // A noise burst has no frequency; the field carries the wave's own nominal
      // centre so a caller drawing a spectrum has an axis label rather than a
      // zero, and it is stated here rather than invented by the page.
      return { kind, sampleRate, frequency: sampleRate / 2, samples };
    }
    case "sine":
    case "square":
    case "triangle":
    case "sawtooth": {
      const frequency = request.frequency;
      assertFrequency(frequency);
      if (frequency * 2 > sampleRate) {
        throw new RangeError("A frequency above half the sample rate would alias to another tone.");
      }
      const start = request.fromPhase ?? 0;
      if (!Number.isFinite(start)) throw new RangeError("A phase must be a finite number of turns.");
      const step = frequency / sampleRate;
      for (let frame = 0; frame < frames; frame += 1) {
        samples.push(sampleWave(request.kind, start + frame * step));
      }
      return { kind: request.kind, sampleRate, frequency, samples };
    }
  }
}

/** The frequency of a logarithmic sweep at `atSeconds` — the shape a hearing check and a filter sweep both use. */
export function sweepFrequency(request: {
  readonly fromHz: number;
  readonly toHz: number;
  readonly seconds: number;
  readonly atSeconds: number;
  readonly logarithmic: boolean;
}): number {
  const { fromHz, toHz, seconds, atSeconds, logarithmic } = request;
  assertFrequency(fromHz);
  assertFrequency(toHz);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError("A sweep needs a positive length.");
  const ratio = Math.min(1, Math.max(0, atSeconds / seconds));
  if (!logarithmic) return fromHz + (toHz - fromHz) * ratio;
  return fromHz * (toHz / fromHz) ** ratio;
}

/** A frequency the generator will produce, or a throw. */
function assertFrequency(frequency: number): void {
  if (
    !Number.isFinite(frequency) ||
    frequency < MIN_FREQUENCY_HZ ||
    frequency > MAX_FREQUENCY_HZ
  ) {
    throw new RangeError(`A frequency must be ${MIN_FREQUENCY_HZ}…${MAX_FREQUENCY_HZ} Hz.`);
  }
}
