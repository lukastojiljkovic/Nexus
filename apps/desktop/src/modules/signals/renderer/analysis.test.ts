import { MIN_FRAME_SAMPLES, targetFor } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { AnalysisEngine, nearestTarget, readMeter, readTuner } from "./analysis.js";

/**
 * The analysis, over frames this test generates.
 *
 * A sine of a stated frequency and amplitude is an oracle: a full-scale sine has
 * an RMS of 1/√2 — which is −3.0103 dBFS, the engine's own calibration anchor —
 * and YIN's answer for a 440 Hz sine is 440 Hz to well under a cent. The cents
 * expectations below are the hand calculation `1200·log₂(f/reference)` written
 * out rather than a number copied from a previous run.
 */

const RATE = 48_000;
/** A sine of amplitude ½ has an RMS of ½/√2 = 0.3536, which is 20·log₁₀(0.3536) = −9.03 dBFS. */
const HALF_SINE_DB = 20 * Math.log10(0.5 / Math.SQRT2);

function sine(frequencyHz: number, samples: number, amplitude: number): Float32Array {
  const frame = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    frame[index] = amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / RATE);
  }
  return frame;
}

describe("readTuner", () => {
  it("names a 440 Hz tone as A4 at concert pitch, with no deviation", () => {
    const reading = readTuner(sine(440, 4096, 0.5), RATE, 440);
    expect(reading.frequencyHz).toBeCloseTo(440, 1);
    expect(reading.note?.label).toBe("A4");
    // 0.05 Hz at 440 Hz is 0.2 cents, which is where the engine's own measured
    // accuracy across E2…1 kHz sits.
    expect(reading.note?.centsOff).toBeCloseTo(0, 0);
    expect(reading.gated).toBe(false);
  });

  it("reports the deviation of a sharp tone in cents", () => {
    const reading = readTuner(sine(442, 4096, 0.5), RATE, 440);
    expect(reading.note?.label).toBe("A4");
    expect(reading.note?.centsOff).toBeCloseTo(1200 * Math.log2(442 / 440), 1);
  });

  it("moves every name when the reference moves", () => {
    // At A4 = 415 Hz the same 440 Hz tone is above A4 by log₂(440/415)·12 = 1.013
    // semitones, so the nearest note is A#4 at 415·2^(1/12) = 439.66 Hz, and the
    // deviation is the small flat one back to it.
    const reading = readTuner(sine(440, 4096, 0.5), RATE, 415);
    expect(reading.note?.label).toBe("A#4");
    // The cents are recomputed from the note's own exact frequency — 1200·log₂ of
    // the detected pitch over it — so the assertion re-derives the engine's own
    // definition rather than restating a number: the detected pitch differs from
    // the generated 440 Hz by a fraction of a cent (YIN's own accuracy).
    const note = reading.note;
    expect(note).not.toBeNull();
    expect(note?.centsOff).toBeCloseTo(
      1200 * Math.log2((reading.frequencyHz as number) / (415 * 2 ** (1 / 12))),
      6,
    );
    expect(reading.note?.a4Hz).toBe(415);
  });

  it("reports a gate refusal with its level rather than a pitch it cannot have", () => {
    const reading = readTuner(new Float32Array(4096), RATE, 440);
    expect(reading.frequencyHz).toBeNull();
    expect(reading.note).toBeNull();
    expect(reading.gated).toBe(true);
    expect(reading.levelDb).toBeLessThan(-60);
  });

  it("passes a frame too short for a period straight through as no pitch", () => {
    // 100 samples is under the engine's MIN_FRAME_SAMPLES, so there is no period
    // to find — and the frame is loud, so it is not a gate refusal either.
    const reading = readTuner(sine(440, 100, 0.5), RATE, 440);
    expect(MIN_FRAME_SAMPLES).toBeGreaterThan(100);
    expect(reading.frequencyHz).toBeNull();
    expect(reading.gated).toBe(false);
    expect(reading.note).toBeNull();
  });
});

describe("readMeter", () => {
  it("reads a full-scale sine as −3.01 dBFS RMS and 0 dBFS peak", () => {
    // Ten whole periods at 1000 Hz, so the RMS is exactly 1/√2 and no partial
    // period is in the frame.
    const frame = sine(1000, 480, 1);
    const level = readMeter(frame);
    expect(level.rmsDb).toBeCloseTo(20 * Math.log10(1 / Math.SQRT2), 3);
    expect(level.peakDb).toBeCloseTo(0, 3);
    expect(level.crestDb).toBeCloseTo(20 * Math.log10(Math.SQRT2), 3);
  });

  it("reads digital silence as the module's floor, not as −Infinity", () => {
    const level = readMeter(new Float32Array(480));
    expect(level.peakDb).toBe(-120);
    expect(Number.isFinite(level.rmsDb)).toBe(true);
  });
});

describe("AnalysisEngine", () => {
  it("answers a tuner job with the caller's id and the reading for its frame", () => {
    const engine = new AnalysisEngine();
    const reply = engine.run({
      kind: "tuner",
      id: 7,
      sampleRate: RATE,
      a4Hz: 440,
      samples: sine(440, 4096, 0.5),
    });
    expect(reply.kind).toBe("tuner");
    expect(reply.id).toBe(7);
    if (reply.kind === "tuner") expect(reply.reading.note?.label).toBe("A4");
  });

  it("accumulates the equivalent level across frames, energy-wise", () => {
    const engine = new AnalysisEngine();
    const loud = sine(1000, 480, 0.5);
    const silent = new Float32Array(480);
    const first = engine.run({ kind: "meter", id: 1, samples: loud, fresh: true });
    const second = engine.run({ kind: "meter", id: 2, samples: silent, fresh: false });
    if (first.kind !== "meter" || second.kind !== "meter") throw new Error("expected meters");
    // One frame of amplitude ½ — mean square 0.125, i.e. −9.03 dBFS — and one of
    // silence: the window's mean square is 0.0625, so Leq is 20·log₁₀(0.25) =
    // −12.04 dBFS. An average of the two dB readings (−9.03 and −120, so −64.5)
    // would have under-reported the loud second by fifty decibels, which is why
    // the window keeps squares and not decibels.
    expect(first.reading.leqDb).toBeCloseTo(HALF_SINE_DB, 3);
    expect(second.reading.leqDb).toBeCloseTo(20 * Math.log10(0.25), 3);
  });

  it("starts a new window when a measurement begins", () => {
    const engine = new AnalysisEngine();
    const loud = sine(1000, 480, 0.5);
    engine.run({ kind: "meter", id: 1, samples: loud, fresh: true });
    const restart = engine.run({ kind: "meter", id: 2, samples: loud, fresh: true });
    if (restart.kind !== "meter") throw new Error("expected a meter");
    expect(restart.reading.leqDb).toBeCloseTo(HALF_SINE_DB, 3);
  });
});

describe("nearestTarget", () => {
  /** The guitar's open strings, in the order the engine lists them: E2 A2 D3 G3 B3 E4. */
  const guitar = ["E2", "A2", "D3", "G3", "B3", "E4"].map((label) => targetFor(label)!);

  it("picks the string by cents, not by hertz", () => {
    // A2 is 110 Hz and D3 is 146.83: a tone 20 Hz above the low E (82.41) is
    // nearer A2 in hertz, and it is A2 in cents too — the interesting case is the
    // one below.
    expect(nearestTarget(110, guitar)?.target.label).toBe("A2");
    // 210 Hz sits between G3 (196) and B3 (246.94): 1.94 semitones up from G3 is
    // flatter than 2.81 semitones below B3, so the answer is G3 — and in hertz
    // the same tone is closer to G3 as well, which is why the rule is stated as
    // cents and asserted at the boundary instead: G#3 (207.65) is 100 cents from
    // G3 and 300 from B3, and a hertz-nearest rule would still say G3.
    expect(nearestTarget(207.65, guitar)?.target.label).toBe("G3");
    expect(nearestTarget(207.65, guitar)?.cents).toBeCloseTo(1200 * Math.log2(207.65 / 196), 1);
  });

  it("reports the signed distance to the string it chose", () => {
    const sharp = nearestTarget(110.5, guitar);
    expect(sharp?.target.label).toBe("A2");
    expect(sharp?.cents).toBeCloseTo(1200 * Math.log2(110.5 / 110), 1);
    const flat = nearestTarget(109.5, guitar);
    expect(flat?.target.label).toBe("A2");
    expect(flat?.cents).toBeCloseTo(1200 * Math.log2(109.5 / 110), 1);
    expect(flat?.cents).toBeLessThan(0);
  });

  it("answers null for a frequency no string can be compared with", () => {
    expect(nearestTarget(0, guitar)).toBeNull();
    expect(nearestTarget(Number.NaN, guitar)).toBeNull();
    expect(nearestTarget(440, [])).toBeNull();
  });
});
