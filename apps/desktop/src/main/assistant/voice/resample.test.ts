import { describe, expect, it } from "vitest";

import { resamplePcm, rateProblem, VOICE_SAMPLE_RATE } from "./resample.js";

/** A sine of `hz`, sampled at `rate` for `seconds`. */
function sine(hz: number, rate: number, seconds: number): Float32Array {
  const length = Math.round(rate * seconds);
  const pcm = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    pcm[index] = Math.sin((2 * Math.PI * hz * index) / rate);
  }
  return pcm;
}

/** The largest absolute difference between two signals' first `count` samples. */
function worstDifference(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  const count = Math.min(a.length, b.length);
  for (let index = 0; index < count; index += 1) {
    worst = Math.max(worst, Math.abs((a[index] as number) - (b[index] as number)));
  }
  return worst;
}

describe("rateProblem", () => {
  it("accepts the rates a recorder actually reports", () => {
    for (const rate of [8_000, 16_000, 22_050, 44_100, 48_000]) {
      expect(rateProblem(rate)).toBeNull();
    }
  });

  it("refuses zero, negatives and non-numbers", () => {
    expect(rateProblem(0)).toBe("not-positive");
    expect(rateProblem(-16_000)).toBe("not-positive");
    expect(rateProblem(Number.NaN)).toBe("not-a-number");
    expect(rateProblem(Number.POSITIVE_INFINITY)).toBe("not-a-number");
  });
});

describe("resamplePcm", () => {
  it("has an exact output length for the ratios a recorder produces", () => {
    // 48 000 samples at 1 s; 48 000 * 16 000 / 48 000 = 16 000.
    expect(resamplePcm(new Float32Array(48_000), 48_000, VOICE_SAMPLE_RATE).length).toBe(16_000);
    // 44 100 at 1 s; 44 100 * 16 000 / 44 100 = 16 000.
    expect(resamplePcm(new Float32Array(44_100), 44_100, VOICE_SAMPLE_RATE).length).toBe(16_000);
    // 16 000 at 1 s up to 48 000.
    expect(resamplePcm(new Float32Array(16_000), VOICE_SAMPLE_RATE, 48_000).length).toBe(48_000);
    // 10 000 samples of 1 s at 44 100 is 0.22676 s, which at 16 000 is 3 628.12 — rounded, exactly.
    expect(resamplePcm(new Float32Array(10_000), 44_100, VOICE_SAMPLE_RATE).length).toBe(3_628);
  });

  it("returns the samples unchanged, and a copy, when the rates are equal", () => {
    const input = sine(440, VOICE_SAMPLE_RATE, 0.01);
    const output = resamplePcm(input, VOICE_SAMPLE_RATE, VOICE_SAMPLE_RATE);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });

  it("keeps a constant exactly constant", () => {
    const input = new Float32Array(4_410).fill(0.25);
    const output = resamplePcm(input, 44_100, VOICE_SAMPLE_RATE);
    for (const sample of output) expect(sample).toBeCloseTo(0.25, 6);
  });

  it("returns an empty signal for an empty signal", () => {
    expect(resamplePcm(new Float32Array(0), 48_000, VOICE_SAMPLE_RATE).length).toBe(0);
  });

  it("refuses a rate it cannot use rather than producing noise", () => {
    expect(() => resamplePcm(new Float32Array(16), 0, VOICE_SAMPLE_RATE)).toThrow(RangeError);
    expect(() => resamplePcm(new Float32Array(16), 16_000, Number.NaN)).toThrow(RangeError);
  });

  it("preserves a tone well below the lower of the two Nyquist limits", () => {
    // 300 Hz survives 48 kHz -> 16 kHz with the band intact; the tolerance is
    // one part in fifty of the amplitude, which is the level at which a tone is
    // audibly unchanged and far tighter than the model's own precision.
    const input = sine(300, 48_000, 0.25);
    const output = resamplePcm(input, 48_000, VOICE_SAMPLE_RATE);
    const expected = sine(300, VOICE_SAMPLE_RATE, 0.25);
    // The kernel's edge effects are the first and last few samples; the middle
    // is the signal.
    expect(worstDifference(output.slice(64, -64), expected.slice(64, -64))).toBeLessThan(0.02);
  });

  it("removes a tone that is above the output's Nyquist limit instead of folding it down", () => {
    // 10 kHz at 48 kHz is 0.208 of the input rate, and well above the 8 kHz
    // Nyquist limit of the 16 kHz output. An aliasing resampler would fold it to
    // 6 kHz with the amplitude intact; this one attenuates it.
    const input = sine(10_000, 48_000, 0.25);
    const output = resamplePcm(input, 48_000, VOICE_SAMPLE_RATE);
    let peak = 0;
    for (const sample of output.slice(64, -64)) peak = Math.max(peak, Math.abs(sample));
    expect(peak).toBeLessThan(0.05);
  });
});
