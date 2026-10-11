import { describe, expect, it } from "vitest";

import {
  createStreamingVad,
  detectSpeechSegments,
  frameLevelDb,
  frameSamples,
  SILENCE_DB,
  streamingFrameSamples,
  VAD_DEFAULTS,
} from "./vad.js";

const RATE = 16_000;

/** Silence, then a tone, then silence again — the shape of one utterance. */
function toneBetween(beforeMs: number, toneMs: number, afterMs: number, hz = 220): Float32Array {
  const before = Math.round((beforeMs / 1000) * RATE);
  const tone = Math.round((toneMs / 1000) * RATE);
  const after = Math.round((afterMs / 1000) * RATE);
  const pcm = new Float32Array(before + tone + after);
  for (let index = 0; index < tone; index += 1) {
    pcm[before + index] = 0.5 * Math.sin((2 * Math.PI * hz * index) / RATE);
  }
  return pcm;
}

/** A deterministic noise burst, used as the speech-like signal. */
function noise(length: number, amplitude: number, seed = 1): Float32Array {
  const pcm = new Float32Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    pcm[index] = ((state / 2_147_483_648) * 2 - 1) * amplitude;
  }
  return pcm;
}

describe("frameLevelDb", () => {
  it("reports silence as the documented floor, not as minus infinity", () => {
    expect(frameLevelDb(new Float32Array(320))).toBe(SILENCE_DB);
  });

  it("reports a full-scale square wave as 0 dB", () => {
    // A square wave of amplitude 1 has an RMS of exactly 1, and 20*log10(1) = 0.
    const frame = new Float32Array(320).fill(1);
    expect(frameLevelDb(frame)).toBeCloseTo(0, 9);
  });

  it("reports half amplitude as about -6 dB", () => {
    // Amplitude 0.5 -> RMS 0.5 -> 20*log10(0.5) = -6.0206.
    expect(frameLevelDb(new Float32Array(320).fill(0.5))).toBeCloseTo(-6.0206, 3);
  });
});

describe("frameSamples", () => {
  it("is 320 samples at 16 kHz and 20 ms", () => {
    expect(frameSamples(16_000, 20)).toBe(320);
    expect(frameSamples(48_000, 20)).toBe(960);
  });
});

describe("detectSpeechSegments", () => {
  it("finds the tone exactly, frame boundary to frame boundary", () => {
    // 200 ms silence (10 frames of 320 samples), 300 ms tone (15 frames),
    // 200 ms silence. The tone's own level is 20*log10(0.5/sqrt(2)) =
    // -9.03 dB, which is above the floor (-100 dB) + 12 dB, so every frame the
    // tone touches is speech. The segment therefore starts at frame 10 and ends
    // at frame 25, which is samples 3 200 to 8 000.
    const segments = detectSpeechSegments(toneBetween(200, 300, 200), RATE);
    expect(segments).toEqual([{ startSample: 3_200, endSample: 8_000 }]);
  });

  it("finds nothing in silence", () => {
    expect(detectSpeechSegments(new Float32Array(RATE), RATE)).toEqual([]);
  });

  it("finds speech-like noise with the same boundaries", () => {
    const pcm = new Float32Array(RATE);
    pcm.set(noise(4_800, 0.4), 1_600);
    const segments = detectSpeechSegments(pcm, RATE);
    // The burst runs from sample 1 600 to 6 400 — frames 5 to 20 — so the
    // frames it touches are 5 through 19, and the segment is 1 600 to 6 400.
    expect(segments).toEqual([{ startSample: 1_600, endSample: 6_400 }]);
  });

  it("merges a gap shorter than minSilenceMs and keeps one longer than it apart", () => {
    // Two 300 ms tones with a 200 ms gap: 200 ms is five frames, below the
    // 400 ms default, so this is one utterance.
    const pcm = new Float32Array(RATE);
    pcm.set(toneBetween(0, 300, 0).subarray(0, 4_800), 1_600);
    pcm.set(toneBetween(0, 300, 0).subarray(0, 4_800), 1_600 + 4_800 + 3_200);
    // The first tone covers frames 5 to 19 and the second 30 to 44, and the ten
    // silent frames between them are one merged run: samples 1 600 to 14 400.
    expect(detectSpeechSegments(pcm, RATE)).toEqual([{ startSample: 1_600, endSample: 14_400 }]);

    // The same two tones with a 500 ms gap are two utterances: the gap is 25
    // frames, above the 20-frame rule.
    const apart = new Float32Array(RATE * 2);
    apart.set(toneBetween(0, 300, 0).subarray(0, 4_800), 1_600);
    apart.set(toneBetween(0, 300, 0).subarray(0, 4_800), 1_600 + 4_800 + 8_000);
    expect(detectSpeechSegments(apart, RATE)).toEqual([
      { startSample: 1_600, endSample: 6_400 },
      { startSample: 14_400, endSample: 19_200 },
    ]);
  });

  it("drops a burst shorter than minSpeechMs", () => {
    // 100 ms of noise is five frames, below the eight-frame floor a 150 ms
    // minimum implies, so it is a click and not an utterance.
    const pcm = new Float32Array(RATE);
    pcm.set(noise(1_600, 0.4, 7), 4_800);
    expect(detectSpeechSegments(pcm, RATE)).toEqual([]);
  });

  it("honours explicit options", () => {
    const pcm = new Float32Array(RATE);
    pcm.set(noise(1_600, 0.4, 7), 4_800);
    expect(detectSpeechSegments(pcm, RATE, { minSpeechMs: 50 })).toEqual([
      { startSample: 4_800, endSample: 6_400 },
    ]);
  });

  it("refuses options it cannot use", () => {
    expect(() => detectSpeechSegments(new Float32Array(320), RATE, { frameMs: 0 })).toThrow(RangeError);
    expect(() => detectSpeechSegments(new Float32Array(320), RATE, { thresholdDb: -1 })).toThrow(RangeError);
    expect(() => detectSpeechSegments(new Float32Array(320), RATE, { minSilenceMs: 1.5 })).toThrow(RangeError);
  });

  it("finds nothing in a signal shorter than one frame", () => {
    expect(detectSpeechSegments(new Float32Array(100), RATE)).toEqual([]);
  });
});

describe("createStreamingVad", () => {
  /** The frame length the defaults imply, so the test slices the same frames the detector sees. */
  const LENGTH = streamingFrameSamples(RATE, VAD_DEFAULTS);

  function frames(pcm: Float32Array): boolean[] {
    const vad = createStreamingVad(RATE);
    const verdicts: boolean[] = [];
    for (let offset = 0; offset + LENGTH <= pcm.length; offset += LENGTH) {
      verdicts.push(vad.push(pcm.subarray(offset, offset + LENGTH)));
    }
    return verdicts;
  }

  it("switches to speech on the first frame that touches the tone and back on the first silent one", () => {
    const verdicts = frames(toneBetween(200, 300, 200));
    expect(verdicts.length).toBe(35);
    expect(verdicts.indexOf(true)).toBe(10);
    expect(verdicts.lastIndexOf(true)).toBe(24);
    expect(verdicts.filter(Boolean).length).toBe(15);
  });

  it("tracks a room that gets noisier, so a raised floor does not swallow speech", () => {
    // The floor starts on the first frame and creeps up only on frames judged
    // non-speech.
    const quiet = noise(RATE, 0.01, 11);
    const vad = createStreamingVad(RATE);
    for (let offset = 0; offset + LENGTH <= RATE; offset += LENGTH) {
      vad.push(quiet.subarray(offset, offset + LENGTH));
    }
    expect(vad.noiseFloorDb).toBeGreaterThan(SILENCE_DB);
    expect(vad.noiseFloorDb).toBeLessThan(-30);
    // Uniform noise of amplitude 0.01 has an RMS of 0.01/sqrt(3), which is
    // -44.8 dB, so the floor sits there and the threshold is around -33 dB.
    const speechFrame = new Float32Array(LENGTH).fill(0.5);
    expect(vad.push(speechFrame)).toBe(true);
  });

  it("reports the documented floor before it has seen anything", () => {
    expect(createStreamingVad(RATE).noiseFloorDb).toBe(SILENCE_DB);
  });
});
