import { describe, expect, it } from "vitest";

import {
  PINK_FILTER,
  newPinkState,
  pinkStep,
  renderWave,
  sampleWave,
  sweepFrequency,
} from "./waveform.js";

/**
 * Every expectation below is either an exact value of the shape's own definition
 * (a sine at a quarter turn IS 1) or a hand calculation written out in the test.
 * "A number between −1 and 1" would pass for silence, which is why none of these
 * asserts a range.
 */
describe("sampleWave", () => {
  it("is the textbook shapes, at the phases that name them", () => {
    expect(sampleWave("sine", 0)).toBe(0);
    expect(sampleWave("sine", 0.25)).toBe(1);
    // sin(π) is 1.2e-16 rather than 0 in binary floating point; the shape is 0.
    expect(sampleWave("sine", 0.5)).toBeCloseTo(0, 12);
    expect(sampleWave("sine", 0.75)).toBe(-1);
    expect(sampleWave("square", 0)).toBe(1);
    expect(sampleWave("square", 0.499)).toBe(1);
    expect(sampleWave("square", 0.5)).toBe(-1);
    expect(sampleWave("square", 1)).toBe(1);
    expect(sampleWave("triangle", 0)).toBe(-1);
    expect(sampleWave("triangle", 0.25)).toBe(0);
    expect(sampleWave("triangle", 0.5)).toBe(1);
    expect(sampleWave("triangle", 0.75)).toBe(0);
    expect(sampleWave("sawtooth", 0)).toBe(-1);
    expect(sampleWave("sawtooth", 0.25)).toBe(-0.5);
    expect(sampleWave("sawtooth", 0.5)).toBe(0);
    expect(sampleWave("sawtooth", 1)).toBe(-1);
  });

  it("wraps a phase outside one turn, in both directions", () => {
    expect(sampleWave("sine", 2.25)).toBe(1);
    // -0.75 turns is a quarter turn PAST the start in the other direction, which
    // is +¼ after wrapping: sin(-270°) is 1, not -1.
    expect(sampleWave("sine", -0.75)).toBe(1);
    expect(sampleWave("sine", -0.25)).toBe(-1);
    expect(sampleWave("sawtooth", -0.5)).toBe(0);
  });
});

describe("renderWave", () => {
  it("renders a sine at its own phase steps, exactly", () => {
    const wave = renderWave({ kind: "sine", sampleRate: 8_000, frequency: 1_000, frames: 8 });
    // 1000 Hz at 8000 Hz advances an eighth of a turn a frame, so the eight
    // samples are the sine at 0, ⅛, ¼ … ⅞ turns.
    const expected = [0, Math.SQRT1_2, 1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2];
    expect(wave.samples).toHaveLength(8);
    expected.forEach((value, index) => {
      expect(wave.samples[index]).toBeCloseTo(value, 12);
    });
    expect(wave.frequency).toBe(1_000);
  });

  it("continues from `fromPhase` rather than restarting, so a second call joins the first", () => {
    const first = renderWave({ kind: "sawtooth", sampleRate: 8_000, frequency: 1_000, frames: 4 });
    const second = renderWave({
      kind: "sawtooth",
      sampleRate: 8_000,
      frequency: 1_000,
      frames: 4,
      fromPhase: 0.5,
    });
    expect(first.samples).toEqual([-1, -0.75, -0.5, -0.25]);
    expect(second.samples).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("renders the same noise twice from one seed, and different noise from another", () => {
    const one = renderWave({ kind: "white", sampleRate: 48_000, frames: 16, seed: 1 });
    const again = renderWave({ kind: "white", sampleRate: 48_000, frames: 16, seed: 1 });
    const other = renderWave({ kind: "white", sampleRate: 48_000, frames: 16, seed: 7 });
    expect(one.samples).toEqual(again.samples);
    expect(one.samples).not.toEqual(other.samples);
    // White noise is two uniform draws minus one from `createSeededRandom`, whose
    // stream `games/random.ts` spells out; seed 1's first draw is
    // 0.6270739405881613 (mulberry32's own arithmetic, in that file).
    expect(one.samples[0]).toBeCloseTo(2 * 0.6270739405881613 - 1, 15);
  });

  it("fills the whole range with white noise and keeps it inside ±1", () => {
    const wave = renderWave({ kind: "white", sampleRate: 48_000, frames: 1_000, seed: 3 });
    const low = Math.min(...wave.samples);
    const high = Math.max(...wave.samples);
    expect(low).toBeGreaterThanOrEqual(-1);
    expect(high).toBeLessThanOrEqual(1);
    // 1000 draws in ±1 with a standard deviation of 1/√3: a stream that stayed
    // inside ±0.5 would be a broken generator, not a quiet one.
    expect(high - low).toBeGreaterThan(1.5);
  });

  it("refuses a frequency that would alias rather than producing a different tone", () => {
    expect(() => renderWave({ kind: "sine", sampleRate: 8_000, frequency: 5_000, frames: 8 })).toThrow(
      RangeError,
    );
    expect(() => renderWave({ kind: "sine", sampleRate: 8_000, frequency: 10, frames: 8 })).toThrow(
      RangeError,
    );
    expect(() => renderWave({ kind: "sine", sampleRate: 4_000, frequency: 1_000, frames: 8 })).toThrow(
      RangeError,
    );
    expect(() => renderWave({ kind: "white", sampleRate: 48_000, frames: 48_001_000 })).toThrow(
      RangeError,
    );
  });
});

describe("pinkStep", () => {
  /**
   * One step's expected output for a white sample of 1, written out term by
   * term rather than recomputed by a loop: with every section empty, `s0` is
   * `1 × 0.5362`, each later section is the previous one times its own input
   * gain, and the output is the sum times the published output gain.
   */
  it("is the seven-section cascade the coefficients describe", () => {
    const state = newPinkState();
    const s0 = 0.5362;
    const s1 = s0 * 0.115926;
    const s2 = s1 * 0.09685;
    const s3 = s2 * 0.08504;
    const s4 = s3 * 0.07037;
    const s5 = s4 * 0.03459;
    const s6 = s5 * 0.01931;
    const expected = (s0 + s1 + s2 + s3 + s4 + s5 + s6) * PINK_FILTER.outputGain;
    expect(pinkStep(state, 1)).toBeCloseTo(expected, 15);
    // …and the state it left behind is exactly those sections.
    expect(state.s0).toBeCloseTo(s0, 15);
    expect(state.s6).toBeCloseTo(s6, 15);
  });

  it("remembers what came before: a second identical sample is a different output", () => {
    const state = newPinkState();
    const first = pinkStep(state, 1);
    const second = pinkStep(state, 1);
    // The sections are one-pole filters: the first step left `s0` at 0.5362, so
    // the second step's `s0` is `0.99886 × 0.5362 + 0.5362` — larger.
    expect(second).toBeGreaterThan(first);
  });
});

describe("sweepFrequency", () => {
  it("walks linearly from one end to the other", () => {
    const request = { fromHz: 100, toHz: 1_000, seconds: 10, logarithmic: false } as const;
    expect(sweepFrequency({ ...request, atSeconds: 0 })).toBe(100);
    expect(sweepFrequency({ ...request, atSeconds: 5 })).toBe(550);
    expect(sweepFrequency({ ...request, atSeconds: 10 })).toBe(1_000);
  });

  it("walks logarithmically when asked, so each decade takes the same time", () => {
    const request = { fromHz: 20, toHz: 2_000, seconds: 4, logarithmic: true } as const;
    expect(sweepFrequency({ ...request, atSeconds: 0 })).toBe(20);
    // Two decades over four seconds: the midpoint is one decade up, 200 Hz.
    expect(sweepFrequency({ ...request, atSeconds: 2 })).toBeCloseTo(200, 9);
    expect(sweepFrequency({ ...request, atSeconds: 4 })).toBeCloseTo(2_000, 9);
  });

  it("holds at the ends rather than running past them, and refuses a length of zero", () => {
    const request = { fromHz: 100, toHz: 200, seconds: 1, logarithmic: false } as const;
    expect(sweepFrequency({ ...request, atSeconds: -1 })).toBe(100);
    expect(sweepFrequency({ ...request, atSeconds: 2 })).toBe(200);
    expect(() => sweepFrequency({ ...request, seconds: 0, atSeconds: 0 })).toThrow(RangeError);
  });
});
