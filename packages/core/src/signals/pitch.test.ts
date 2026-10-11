import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLARITY,
  DEFAULT_MAX_HZ,
  DEFAULT_MIN_HZ,
  MIN_FRAME_SAMPLES,
  detectPitch,
} from "./pitch.js";
import { SILENCE_FLOOR_DB } from "./soundLevel.js";

const RATE = 48_000;
/** The two frame sizes the acceptance claim is made about, from stage 1's brief. */
const FRAMES = [2048, 4096];
/** E2 to B5: every semitone from the guitar's low E up to the top under 1 kHz. */
const LOWEST_MIDI = 40;
const HIGHEST_MIDI = 83;
/** Two phases, because a lag that lands on the grid is the easy case. */
const PHASES = [0, 0.37];

function sine(frequencyHz: number, length: number, phase = 0, amplitude = 1): Float32Array {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / RATE + phase);
  }
  return samples;
}

/**
 * A band-limited sawtooth: every harmonic the rate can carry, at 1/k. It is the
 * waveform a bowed or blown note leans towards, and the one an octave error is
 * made on, because its second harmonic is only 6 dB below the first.
 */
function sawtooth(fundamentalHz: number, length: number, noise: number, random: () => number): Float32Array {
  const samples = new Float32Array(length);
  const harmonics = Math.floor(RATE / 2 / fundamentalHz);
  for (let index = 0; index < length; index += 1) {
    let value = 0;
    for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
      value += Math.sin((2 * Math.PI * fundamentalHz * harmonic * index) / RATE) / harmonic;
    }
    samples[index] = value * 0.5 + (random() * 2 - 1) * noise;
  }
  return samples;
}

/**
 * The same seeded generator the Morse tests use (mulberry32). Noise that is the
 * same noise on every run is what makes „never an octave off" a test rather
 * than a sample.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** The midi-to-frequency arithmetic of 12-TET, written here so the grid is not the module's own. */
function pitchOf(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function centsBetween(detectedHz: number | null, expectedHz: number): number {
  if (detectedHz === null) return Number.POSITIVE_INFINITY;
  return 1200 * Math.log2(detectedHz / expectedHz);
}

describe("YIN on synthetic tones", () => {
  it(
    "reads every semitone from E2 to 1 kHz to better than a cent, in 2048 and 4096 samples",
    () => {
      let worst = 0;
      let worstHz = 0;
      let readings = 0;
      for (const length of FRAMES) {
        for (const phase of PHASES) {
          for (let midi = LOWEST_MIDI; midi <= HIGHEST_MIDI; midi += 1) {
            const expected = pitchOf(midi);
            const detected = detectPitch(sine(expected, length, phase), { sampleRate: RATE });
            const error = Math.abs(centsBetween(detected.frequencyHz, expected));
            expect(error, `${expected.toFixed(2)} Hz, ${length} samples, phase ${phase}`).toBeLessThan(1);
            expect(detected.gated, `${expected.toFixed(2)} Hz`).toBe(false);
            // A full-scale sine is −3.01 dBFS RMS; a frame that is not a whole
            // number of cycles lands a hair either side of it.
            expect(Math.abs(detected.levelDb + 3.01), `${expected.toFixed(2)} Hz`).toBeLessThan(0.1);
            if (error > worst) {
              worst = error;
              worstHz = expected;
            }
            readings += 1;
          }
        }
      }
      // Nothing may be skipped: 44 semitones × 2 frames × 2 phases.
      expect(readings).toBe(2 * 2 * (HIGHEST_MIDI - LOWEST_MIDI + 1));
      // Measured on this machine: the worst reading in the grid is 0.22 cents
      // (830.61 Hz, 4096 samples, phase 0.37), and the claim is one cent.
      expect(worst, `worst reading was ${worst.toFixed(4)} cents at ${worstHz.toFixed(2)} Hz`).toBeLessThan(1);
    },
    30_000,
  );

  it("never puts a noisy sawtooth an octave out, or even a tenth of one", () => {
    let worst = 0;
    for (const fundamental of [82.41, 110, 220, 440]) {
      for (const seed of [1, 2, 3]) {
        const random = seeded(seed);
        for (const noise of [0.02, 0.1]) {
          const detected = detectPitch(sawtooth(fundamental, 4096, noise, random), { sampleRate: RATE });
          const error = Math.abs(centsBetween(detected.frequencyHz, fundamental));
          // A period-doubling error is 1200 cents, so this is the octave test
          // and the cent test at the same time.
          expect(error, `${fundamental} Hz, seed ${seed}, noise ${noise}`).toBeLessThan(50);
          expect(detected.clarity, `${fundamental} Hz, seed ${seed}`).toBeGreaterThan(DEFAULT_CLARITY);
          worst = Math.max(worst, error);
        }
      }
    }
    // Measured on this machine: the worst sawtooth reading is 0.41 cents.
    expect(worst).toBeLessThan(1);
  });

  it("answers no pitch for silence and for white noise", () => {
    const silence = detectPitch(new Float32Array(4096), { sampleRate: RATE });
    expect(silence.frequencyHz).toBeNull();
    expect(silence.clarity).toBe(0);
    expect(silence.gated).toBe(true);
    expect(silence.levelDb).toBe(SILENCE_FLOOR_DB);

    for (const seed of [1, 2, 3, 4, 5]) {
      const random = seeded(seed);
      const noise = new Float32Array(4096);
      for (let index = 0; index < noise.length; index += 1) noise[index] = random() * 2 - 1;
      const detected = detectPitch(noise, { sampleRate: RATE });
      expect(detected.gated, `seed ${seed}`).toBe(false); // loud enough to judge
      expect(detected.frequencyHz, `seed ${seed}`).toBeNull(); // and not periodic
    }
  });
});

describe("what a detection reports", () => {
  it("reports the level of the frame whether or not it found a pitch", () => {
    expect(detectPitch(sine(440, 4096), { sampleRate: RATE }).levelDb).toBeCloseTo(-3.01, 1);
    // An amplitude of 1e-4 is −80 dBFS at its peak and −83.01 dBFS RMS, which
    // is the figure this module reports.
    expect(detectPitch(sine(440, 4096, 0, 1e-4), { sampleRate: RATE }).levelDb).toBeCloseTo(-83.01, 1);
    expect(detectPitch(sine(440, 4096), { sampleRate: RATE, clarityThreshold: 0.1 }).clarity).toBeGreaterThan(0.99);
  });

  it("gates a frame that is too quiet to judge, and can be told where the gate is", () => {
    const quiet = sine(440, 4096, 0, 1e-4); // −80 dBFS
    expect(detectPitch(quiet, { sampleRate: RATE })).toMatchObject({ frequencyHz: null, gated: true });
    const belowTheGate = detectPitch(quiet, { sampleRate: RATE, levelGateDb: -100 });
    expect(belowTheGate.gated).toBe(false);
    expect(belowTheGate.frequencyHz).toBeCloseTo(440, 0);
  });

  it("refuses a reading the caller did not ask to trust", () => {
    const clean = detectPitch(sine(440, 4096), { sampleRate: RATE });
    expect(clean.frequencyHz).toBeCloseTo(440, 1);
    // The same frame under a threshold above its own clarity is „no pitch",
    // which is the whole of what the threshold is for.
    expect(detectPitch(sine(440, 4096), { sampleRate: RATE, clarityThreshold: 0.999999 }).frequencyHz).toBeNull();
  });

  it("has no period to find below the frame and the range it was given", () => {
    // A search whose window stops short of the tone has no minimum to find.
    expect(detectPitch(sine(110, 4096), { sampleRate: RATE, minHz: 200 }).frequencyHz).toBeNull();
    // And a frame under the floor is refused before any of that, rather than
    // answered from a window too short to hold a period.
    expect(detectPitch(sine(440, MIN_FRAME_SAMPLES - 1), { sampleRate: RATE }).frequencyHz).toBeNull();
    expect(detectPitch(sine(440, MIN_FRAME_SAMPLES), { sampleRate: RATE }).frequencyHz).toBeCloseTo(440, 0);
    expect(detectPitch(new Float32Array(0), { sampleRate: RATE }).frequencyHz).toBeNull();
    expect(detectPitch(sine(440, 4096), { sampleRate: 0 }).frequencyHz).toBeNull();
  });

  it("states its defaults as numbers a screen can show", () => {
    // YIN's published absolute threshold of 0.1 on `d′`, read on the clarity
    // scale this module reports: `1 − 0.1`.
    expect(DEFAULT_CLARITY).toBe(0.9);
    expect(DEFAULT_MIN_HZ).toBe(40);
    expect(DEFAULT_MAX_HZ).toBe(2000);
    expect(MIN_FRAME_SAMPLES).toBe(256);
  });
});
