import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEVEL_GATE_DB,
  LeqWindow,
  SILENCE_FLOOR_DB,
  aWeightingDb,
  amplitudeFromDbfs,
  applyAWeighting,
  biquadCascadeDb,
  dBfsFromAmplitude,
  dBfsFromPeak,
  dBfsFromRms,
  designAWeighting,
  frameLevel,
  leqFromFrameLevels,
  leqFromFrameRms,
  peak,
  rms,
  splFromDbfs,
} from "./soundLevel.js";

/**
 * A full-scale sine, the reference signal of every level claim below, over a
 * whole number of cycles so the RMS is the sine's own and not a partial period.
 */
function sine(frequencyHz: number, sampleRate: number, length: number): Float32Array {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
  }
  return samples;
}

describe("levels of a frame", () => {
  it("reads a full-scale sine at −3.01 dBFS RMS and 0 dBFS peak", () => {
    // RMS of a sine of amplitude 1 is 1/√2 = 0.70710678…, and
    // 20·log₁₀(0.70710678) = −3.0103. Stated source: the definition of RMS plus
    // the dBFS scale, both of which are the arithmetic below.
    const samples = sine(1000, 48_000, 48_000);
    expect(20 * Math.log10(1 / Math.SQRT2)).toBeCloseTo(-3.0103, 4);
    expect(dBfsFromRms(rms(samples))).toBeCloseTo(-3.0103, 3);
    expect(dBfsFromPeak(peak(samples))).toBeCloseTo(0, 3);
    expect(frameLevel(samples).crestDb).toBeCloseTo(3.0103, 3);
  });

  it("reports a half-scale sine at −9.03 dBFS, which is the same 6.02 dB down", () => {
    const samples = sine(440, 48_000, 48_000);
    for (let index = 0; index < samples.length; index += 1) samples[index] = (samples[index] as number) / 2;
    expect(dBfsFromRms(rms(samples))).toBeCloseTo(-9.0309, 3);
  });

  it("floors digital silence at the reported floor rather than at −Infinity", () => {
    expect(dBfsFromRms(rms(new Float32Array(64)))).toBe(SILENCE_FLOOR_DB);
    expect(dBfsFromPeak(peak(new Float32Array(64)))).toBe(SILENCE_FLOOR_DB);
    expect(amplitudeFromDbfs(SILENCE_FLOOR_DB)).toBe(0);
    expect(amplitudeFromDbfs(-3.0103)).toBeCloseTo(1 / Math.SQRT2, 4);
  });

  it("keeps 0 dBFS at amplitude 1 in both directions", () => {
    expect(dBfsFromAmplitude(1)).toBeCloseTo(0, 12);
    expect(amplitudeFromDbfs(0)).toBe(1);
    expect(dBfsFromAmplitude(2)).toBeCloseTo(6.0206, 3);
  });
});

describe("Leq over a window", () => {
  it("equals the RMS when every frame has the same level", () => {
    const level = rms(sine(1000, 48_000, 1024));
    expect(leqFromFrameRms([level, level, level, level])).toBeCloseTo(dBfsFromRms(level), 12);
  });

  it("weights a loud frame by its energy, not by its decibels", () => {
    // Three quiet frames and one full-scale one is a fourth of the energy, so
    // the window is 6.02 dB below the loud frame — where averaging the dB
    // values would have reported 3.77 dB below it. Hand calculation:
    // mean of squares = (0.25 + 0 + 0 + 0)/4 = 0.0625, √ = 0.25,
    // 20·log₁₀(0.25) = −12.04.
    const leq = leqFromFrameRms([0.5, 0, 0, 0]);
    expect(leq).toBeCloseTo(-12.0412, 3);
    expect(leq).toBeGreaterThan(leqFromFrameLevels([dBfsFromRms(0.5), SILENCE_FLOOR_DB, SILENCE_FLOOR_DB, SILENCE_FLOOR_DB]) - 0.001);
    expect(leqFromFrameLevels([-6.0206, SILENCE_FLOOR_DB, SILENCE_FLOOR_DB, SILENCE_FLOOR_DB])).toBeCloseTo(-12.0412, 2);
  });

  it("floors an empty window instead of dividing by zero", () => {
    expect(leqFromFrameRms([])).toBe(SILENCE_FLOOR_DB);
    expect(new LeqWindow().leqDb).toBe(SILENCE_FLOOR_DB);
  });

  it("accumulates frames and starts a fresh window on reset", () => {
    const window = new LeqWindow();
    const frame = sine(1000, 48_000, 48_000);
    window.addFrame(frame);
    window.addFrame(frame);
    expect(window.frameCount).toBe(2);
    expect(window.leqDb).toBeCloseTo(-3.0103, 3);
    window.reset();
    expect(window.frameCount).toBe(0);
    expect(window.leqDb).toBe(SILENCE_FLOOR_DB);
    window.addFrameRms(0.5);
    expect(window.leqDb).toBeCloseTo(-6.0206, 3);
  });
});

describe("A-weighting", () => {
  /**
   * IEC 61672-1's nominal table, in dB, at the frequencies the standard prints
   * it at. The table is rounded to 0.1 dB, so the check below allows 0.15 — the
   * rounding plus a margin.
   */
  const IEC_61672_NOMINAL_TABLE: ReadonlyArray<readonly [frequencyHz: number, gainDb: number]> = [
    [31.5, -39.4],
    [63, -26.2],
    [100, -19.1],
    [125, -16.1],
    [250, -8.6],
    [500, -3.2],
    [1000, 0],
    [2000, 1.2],
    [4000, 1.0],
    [8000, -1.1],
    [10000, -2.5],
    [16000, -6.6],
    [20000, -9.3],
  ];

  /** Third-octave nominal frequencies from 20 Hz up; the range check walks these. */
  const THIRD_OCTAVE_HZ: readonly number[] = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
    2500, 3150, 4000, 5000, 6300, 8000, 10000, 11200,
  ];

  /**
   * The measured deviation of the DIGITAL cascade from `aWeightingDb`, in dB, at
   * the top of the band: the bilinear map's compression of the frequency axis,
   * which `designAWeighting` explains. Pinned here so a later change cannot hide
   * it.
   *
   * 12.5 kHz is listed at the two high rates because that is where the deviation
   * first passes 0.5 dB, which is why the range check below stops at 11.2 kHz
   * rather than running to the 12.5 kHz the design is meant for.
   */
  const CASCADE_DROOP_DB: ReadonlyArray<readonly [sampleRate: number, frequencyHz: number, deviationDb: number]> = [
    [44_100, 10_000, -1.5],
    [48_000, 10_000, -1.22],
    [88_200, 10_000, -0.31],
    [96_000, 10_000, -0.26],
    [88_200, 12_500, -0.64],
    [96_000, 12_500, -0.53],
  ];

  it("matches the standard's nominal table within 0.15 dB", () => {
    for (const [frequencyHz, gainDb] of IEC_61672_NOMINAL_TABLE) {
      expect(Math.abs(aWeightingDb(frequencyHz) - gainDb), `at ${frequencyHz} Hz`).toBeLessThan(0.15);
    }
    // 0 dB at 1 kHz is the definition's own normalisation, so it comes out
    // exact rather than close.
    expect(aWeightingDb(1000)).toBeCloseTo(0, 9);
  });

  it.each([
    [6_300, 44_100],
    [6_300, 48_000],
    [11_200, 88_200],
    [11_200, 96_000],
  ])("keeps the cascade within 0.5 dB of the definition up to %i Hz at %i Hz", (topHz, sampleRate) => {
    const filter = designAWeighting(sampleRate);
    for (const frequencyHz of THIRD_OCTAVE_HZ) {
      if (frequencyHz > topHz) break;
      const deviation = biquadCascadeDb(filter.sections, frequencyHz, sampleRate) - aWeightingDb(frequencyHz);
      expect(Math.abs(deviation), `at ${frequencyHz} Hz, ${sampleRate} Hz sample rate`).toBeLessThan(0.5);
    }
  });

  it("pins the cascade's droop at the top of the band", () => {
    for (const [sampleRate, frequencyHz, deviationDb] of CASCADE_DROOP_DB) {
      const filter = designAWeighting(sampleRate);
      const deviation = biquadCascadeDb(filter.sections, frequencyHz, sampleRate) - aWeightingDb(frequencyHz);
      expect(Math.abs(deviation - deviationDb), `at ${frequencyHz} Hz, ${sampleRate} Hz sample rate`).toBeLessThan(0.05);
    }
  });

  it("puts a full-scale 1 kHz sine at the definition's own 0 dB gain", () => {
    const filter = designAWeighting(48_000);
    const weighted = applyAWeighting(sine(1000, 48_000, 48_000), filter);
    // The cascade is pinned to exactly 0 dB at 1 kHz, so the reading is the
    // sine's own RMS and nothing else: 20·log₁₀(1/√2) = −3.0103 dBFS.
    const sineRmsDb = 20 * Math.log10(1 / Math.SQRT2);
    expect(Math.abs(dBfsFromRms(rms(weighted)) - sineRmsDb)).toBeLessThan(0.05);
  });

  it("runs every section, so a 10 kHz sine is 1.22 dB below what the definition asks", () => {
    const filter = designAWeighting(48_000);
    const raw = sine(10_000, 48_000, 48_000);
    const weighted = applyAWeighting(raw, filter);
    // The first 4800 samples are the cascade's transient. The rest is nine whole
    // cycles of the tone, so both readings are the tone's own and their
    // difference is the filter's gain at 10 kHz and nothing else.
    const settled = 4800;
    const difference = dBfsFromRms(rms(weighted.subarray(settled))) - dBfsFromRms(rms(raw.subarray(settled)));
    expect(Math.abs(difference - (aWeightingDb(10_000) - 1.22))).toBeLessThan(0.1);
  });

  it("leaves a signal shorter than one sample unweighted rather than crashing", () => {
    const filter = designAWeighting(44_100);
    expect(applyAWeighting(new Float32Array(0), filter).length).toBe(0);
  });

  it("refuses a rate the design cannot be mapped at", () => {
    expect(() => designAWeighting(8000)).toThrow(RangeError);
  });
});

describe("calibration", () => {
  it("converts dBFS to dB SPL only when the user supplies an offset", () => {
    expect(splFromDbfs(-3.01, 94)).toBeCloseTo(90.99, 2);
    expect(splFromDbfs(-3.01, 0)).toBeCloseTo(-3.01, 6);
    expect(splFromDbfs(Number.NaN, 94)).toBeNull();
    expect(splFromDbfs(-3.01, Number.NaN)).toBeNull();
  });

  it("states the gate as a level, so a quiet frame is not analysed", () => {
    expect(DEFAULT_LEVEL_GATE_DB).toBe(-60);
  });
});
