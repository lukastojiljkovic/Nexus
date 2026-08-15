import { describe, expect, it } from "vitest";

import {
  audioLevel,
  barDuration,
  barsInDuration,
  bufferLatency,
  centsRatio,
  compressorCurve,
  decibelRatio,
  decibelSum,
  delayTimes,
  delayTimesFromMeasuredMs,
  midiToPitch,
  pcmDuration,
  pcmSize,
  pitchFromFrequency,
  pitchFromName,
  reverbTime,
  roomModes,
  sampleCount,
  sampleDuration,
  soundWavelength,
  speakerLoad,
  spellChord,
  spellScale,
  splAtDistance,
  transposeKey,
  transposePitch,
  transposeText,
  varispeed,
} from "./muzika.js";

/**
 * Every expectation here was worked by hand from the inputs before it was
 * checked against the code, and the arithmetic is written into the comments so
 * a reader can verify it without running anything. Where the assignment's own
 * catalogue vector disagreed with a hand re-derivation, the comment says so.
 */

describe("audioLevel", () => {
  it("+4 dBu into 600 ohm: Vrms, dBV and — because 600 ohm is where the two scales coincide — dBm == dBu", () => {
    // Vrms = sqrt(0.6) * 10^(4/20) = 0.7745966692 * 1.5848931925 = 1.2276529811
    const result = audioLevel({ entry: { kind: "dbu", value: 4 }, impedance: 600 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vrms).toBeCloseTo(1.227653, 6);
    // dBV = dBu - 2.2184874962 = 4 - 2.2184874962 = 1.7815125038
    expect(result.dbv).toBeCloseTo(1.781513, 5);
    // 0 dBu is DEFINED as 1 mW into 600 ohm, so at exactly 600 ohm dBm == dBu.
    expect(result.dbm).toBeCloseTo(4, 3);
    expect(result.dbu).toBeCloseTo(4, 9);
  });

  it("-10 dBV: Vrms, dBu and peak figures, and the standard -10 dBV/+4 dBu 11.79 dB offset", () => {
    // Vrms = 10^(-10/20) = 10^-0.5 = 0.3162277660
    const result = audioLevel({ entry: { kind: "dbv", value: -10 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vrms).toBeCloseTo(0.316228, 6);
    // dBu = -10 + 2.2184874962 = -7.7815125038
    expect(result.dbu).toBeCloseTo(-7.781513, 5);
    // Vpeak = 0.3162277660 * sqrt(2) = 0.4472135955; Vpp = 2x that.
    expect(result.vpeak).toBeCloseTo(0.447214, 6);
    expect(result.vpp).toBeCloseTo(0.894427, 6);
    expect(result.dbm).toBeUndefined(); // no impedance typed
  });

  it("0 dBm into 50 ohm vs 600 ohm land on different voltages — the impedance is never assumed", () => {
    // Vrms = sqrt(0.001 * 50 * 10^0) = sqrt(0.05) = 0.2236067977
    const at50 = audioLevel({ entry: { kind: "dbm", value: 0 }, impedance: 50 });
    expect(at50.ok).toBe(true);
    if (!at50.ok) return;
    expect(at50.vrms).toBeCloseTo(0.223607, 6);
    // dBV = 20*log10(0.2236067977) = -13.0103
    expect(at50.dbv).toBeCloseTo(-13.0103, 3);

    // Vrms = sqrt(0.001*600*1) = sqrt(0.6), i.e. exactly the 0 dBu reference.
    const at600 = audioLevel({ entry: { kind: "dbm", value: 0 }, impedance: 600 });
    expect(at600.ok).toBe(true);
    if (!at600.ok) return;
    expect(at600.dbu).toBeCloseTo(0, 6);
  });

  it("dBFS entry needs a calibration and then converts through the same conversion row", () => {
    // EBU: +4 dBu = -18 dBFS, so 0 dBFS sits at 4 - (-18) = 22 dBu. Feeding -18
    // dBFS back through that calibration must land on the same +4 dBu vector.
    const result = audioLevel({
      entry: { kind: "dbfs", value: -18 },
      calibration: { kind: "dbfs-at-plus4-dbu", value: -18 },
      impedance: 600,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dbu).toBeCloseTo(4, 6);
    expect(result.vrms).toBeCloseTo(1.227653, 6);
  });

  it("dBFS is also reported as an OUTPUT for every other entry point once a calibration is given", () => {
    // dbuAt0Dbfs = 22 typed directly; dBu entry of 4 -> dBFS = 4 - 22 = -18.000
    const result = audioLevel({
      entry: { kind: "dbu", value: 4 },
      calibration: { kind: "dbu-at-0-dbfs", value: 22 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dbfs).toBeCloseTo(-18, 6);
  });

  it("refuses rather than repairs: out-of-range levels, a dbm/dbfs entry with no impedance/calibration, a non-positive voltage or impedance", () => {
    expect(audioLevel({ entry: { kind: "dbu", value: 200 } })).toEqual({ ok: false, reason: "dbu" });
    expect(audioLevel({ entry: { kind: "vrms", value: 0 } })).toEqual({ ok: false, reason: "vrms" });
    expect(audioLevel({ entry: { kind: "vpp", value: -1 } })).toEqual({ ok: false, reason: "vpp" });
    expect(audioLevel({ entry: { kind: "dbm", value: 0 } })).toEqual({ ok: false, reason: "impedance" });
    expect(audioLevel({ entry: { kind: "dbfs", value: -18 } })).toEqual({
      ok: false,
      reason: "calibration",
    });
    expect(audioLevel({ entry: { kind: "dbu", value: 4 }, impedance: -600 })).toEqual({
      ok: false,
      reason: "impedance",
    });
  });

  it("refuses a non-finite or wildly out-of-range calibration value instead of printing a garbage dBFS answer", () => {
    // Neither figure ever reaches `levelEntryToVrms` for a `dbu` entry — only
    // the `dbfs` OUTPUT field uses it (`dbu - dbuAt0Dbfs`) — so without a guard
    // on the calibration itself, 4 - NaN and 4 - 1e9 would both come back
    // `ok: true` with a `dbfs` field nobody validated.
    expect(
      audioLevel({
        entry: { kind: "dbu", value: 4 },
        calibration: { kind: "dbu-at-0-dbfs", value: Number.NaN },
      }),
    ).toEqual({ ok: false, reason: "calibration" });
    expect(
      audioLevel({
        entry: { kind: "dbu", value: 4 },
        calibration: { kind: "dbu-at-0-dbfs", value: 1e9 },
      }),
    ).toEqual({ ok: false, reason: "calibration" });
  });
});

describe("decibelRatio", () => {
  it("amplitude vs power: the factor-of-two difference between 20*log10 and 10*log10", () => {
    // 20*log10(2) = 20*0.30103 = 6.0206
    const amplitude = decibelRatio({ entry: { kind: "ratio", value: 2 }, quantity: "amplitude" });
    expect(amplitude.ok).toBe(true);
    if (amplitude.ok) expect(amplitude.decibels).toBeCloseTo(6.0206, 3);
    // 10*log10(2) = 3.0103
    const power = decibelRatio({ entry: { kind: "ratio", value: 2 }, quantity: "power" });
    expect(power.ok).toBe(true);
    if (power.ok) expect(power.decibels).toBeCloseTo(3.0103, 3);
  });

  it("-6 dB amplitude is just over half the voltage and exactly a quarter of the power", () => {
    // ratio = 10^(-6/20) = 10^-0.3 = 0.5011872336
    const result = decibelRatio({ entry: { kind: "decibels", value: -6 }, quantity: "amplitude" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(0.501187, 6);
    expect(result.ratio ** 2).toBeCloseTo(0.251189, 6);
    expect(result.percent).toBeCloseTo(50.1187, 3);
  });

  it("refuses a non-positive ratio rather than returning -Infinity, and an out-of-range decibel figure", () => {
    expect(decibelRatio({ entry: { kind: "ratio", value: 0 } })).toEqual({ ok: false, reason: "ratio" });
    expect(decibelRatio({ entry: { kind: "ratio", value: -1 } })).toEqual({ ok: false, reason: "ratio" });
    expect(decibelRatio({ entry: { kind: "decibels", value: 500 } })).toEqual({
      ok: false,
      reason: "decibels",
    });
  });

  it("refuses an unrecognised quantity selector rather than silently defaulting to amplitude", () => {
    expect(
      decibelRatio({ entry: { kind: "ratio", value: 2 }, quantity: "loudness" as unknown as "amplitude" }),
    ).toEqual({ ok: false, reason: "quantity" });
  });
});

describe("decibelSum", () => {
  it("two equal 90.0 dB sources sum to 93.0103 dB and split the energy 50/50", () => {
    // 10*log10(1e9 + 1e9) = 10*log10(2e9) = 90 + 10*log10(2) = 93.0103
    const result = decibelSum({ levels: [90, 90] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sum).toBeCloseTo(93.0103, 3);
    expect(result.shares[0]?.percent).toBeCloseTo(50, 2);
    expect(result.shares[1]?.percent).toBeCloseTo(50, 2);
  });

  it("85.0 and 90.0 dB: the 90 dB source holds 75.97% of the energy, not half", () => {
    // 10^8.5 = 3.162278e8, 10^9 = 1e9, sum = 1.316228e9
    // 10*log10(1.316228e9) = 10*9.119331 = 91.1933
    const result = decibelSum({ levels: [85, 90] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sum).toBeCloseTo(91.1933, 3);
    expect(result.shares[0]?.percent).toBeCloseTo(24.03, 1);
    expect(result.shares[1]?.percent).toBeCloseTo(75.97, 1);
  });

  it("refuses an empty or oversized list and a level outside -200..200", () => {
    expect(decibelSum({ levels: [] })).toEqual({ ok: false, reason: "levels" });
    expect(decibelSum({ levels: [300] })).toEqual({ ok: false, reason: "levels" });
  });
});

describe("compressorCurve", () => {
  it("hard knee (W=0), above threshold: y = T + (x-T)/R, with makeup applied afterward", () => {
    // 2*(-8+20) = 24 > 0 = W, so y = -20 + 12/4 = -17.000; GR = -8 - (-17) = 9.000
    const result = compressorCurve({ threshold: -20, ratio: 4, knee: 0, inputLevel: -8, makeup: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outputLevel).toBeCloseTo(-17, 6);
    expect(result.gainReduction).toBeCloseTo(9, 6);
    expect(result.outputWithMakeup).toBeCloseTo(-11, 6);
  });

  it("makeupToReference restores a STATED reference level through the same curve, not a hard-coded 0 dBFS", () => {
    // At x=0: y = -20 + 20/4 = -15.000, so the makeup that restores 0 dBFS is 15.000 dB.
    const result = compressorCurve({
      threshold: -20,
      ratio: 4,
      inputLevel: -8,
      makeupReferenceLevel: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.makeupToReference).toBeCloseTo(15, 6);
  });

  it("without a stated reference level, makeupToReference is undefined rather than assuming full scale", () => {
    const result = compressorCurve({ threshold: -20, ratio: 4, inputLevel: -8 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.makeupToReference).toBeUndefined();
  });

  it("the 6 dB knee reaches BELOW the threshold: at x=T the curve is already 0.563 dB down", () => {
    // over = 0, |0| <= 6: y = -20 + (0.25-1)*(0+3)^2/12 = -20 + (-0.75)*9/12 = -20 - 0.5625
    const result = compressorCurve({ threshold: -20, ratio: 4, knee: 6, inputLevel: -20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outputLevel).toBeCloseTo(-20.5625, 4);
    expect(result.gainReduction).toBeCloseTo(0.5625, 4);
  });

  it("the two knee branches meet exactly at the upper knee edge — the continuity check", () => {
    // Inside: y = -17 + (-0.75)*(-17+20+3)^2/12 = -17 + (-0.75)*36/12 = -19.250
    // Above:  y = -20 + (-17+20)/4 = -19.250 — same answer from the other branch.
    const result = compressorCurve({ threshold: -20, ratio: 4, knee: 6, inputLevel: -17 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outputLevel).toBeCloseTo(-19.25, 4);
  });

  it("below the knee, output equals input and gain reduction is exactly zero", () => {
    const result = compressorCurve({ threshold: -20, ratio: 4, knee: 6, inputLevel: -24 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outputLevel).toBe(-24);
    expect(result.gainReduction).toBe(0);
  });

  it("refuses rather than repairs: threshold, ratio, knee, inputLevel, makeup and makeupReferenceLevel out of range", () => {
    expect(compressorCurve({ threshold: 5, ratio: 4, inputLevel: -8 })).toEqual({
      ok: false,
      reason: "threshold",
    });
    expect(compressorCurve({ threshold: -20, ratio: 0.5, inputLevel: -8 })).toEqual({
      ok: false,
      reason: "ratio",
    });
    expect(compressorCurve({ threshold: -20, ratio: 4, knee: -1, inputLevel: -8 })).toEqual({
      ok: false,
      reason: "knee",
    });
    expect(compressorCurve({ threshold: -20, ratio: 4, inputLevel: 100 })).toEqual({
      ok: false,
      reason: "inputLevel",
    });
    expect(compressorCurve({ threshold: -20, ratio: 4, inputLevel: -8, makeup: 100 })).toEqual({
      ok: false,
      reason: "makeup",
    });
    expect(
      compressorCurve({ threshold: -20, ratio: 4, inputLevel: -8, makeupReferenceLevel: 100 }),
    ).toEqual({ ok: false, reason: "makeupReferenceLevel" });
  });
});

describe("midiToPitch / pitchFromName / pitchFromFrequency", () => {
  it("A4 (MIDI 69) is exactly the reference; C4 (MIDI 60) is 440*2^(-9/12)", () => {
    const a4 = midiToPitch({ midi: 69 });
    expect(a4.ok).toBe(true);
    if (a4.ok) {
      expect(a4.frequency).toBeCloseTo(440, 6);
      expect(a4.name).toBe("A4");
    }
    // 440 * 2^(-9/12) = 440 * 0.5946035575 = 261.6255653
    const c4 = midiToPitch({ midi: 60 });
    expect(c4.ok).toBe(true);
    if (c4.ok) expect(c4.frequency).toBeCloseTo(261.626, 3);
  });

  it("MIDI 40 at ref 440 is E2, the low E of a guitar — 440*2^(-29/12) = 82.4069 Hz", () => {
    // 2^(-29/12): -29/12 = -2.41666667; 2^-2.41666667 = 0.1872885 (NOT 0.1872697 —
    // that figure in the assignment's own vector was itself wrong, though its
    // final 82.407 Hz answer was right).
    const result = midiToPitch({ midi: 40 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("E2");
    expect(result.frequency).toBeCloseTo(82.407, 3);
  });

  it("the note nearest 100 Hz is G2, sharp by +35.00 cents", () => {
    // mExact = 69 + 12*log2(100/440) = 69 - 25.65004236 = 43.349958
    // mNearest = 43 (G2); cents = (43.349958 - 43)*100 = +34.996 -> +35.00 (2dp)
    const result = pitchFromFrequency({ frequency: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.midiExact).toBeCloseTo(43.349958, 5);
    expect(result.name).toBe("G2");
    expect(result.cents).toBeCloseTo(34.996, 2);
  });

  it("a stated reference of 442 shifts C4 to 262.815 Hz", () => {
    // 442 * 2^(-9/12) = 442 * 0.5946035575 = 262.8147724
    const result = midiToPitch({ midi: 60, referencePitch: 442 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frequency).toBeCloseTo(262.815, 3);
  });

  it("the octave numbering is a stated convention: MIDI 60 is C4 (scientific) or C3 (Yamaha)", () => {
    const scientific = midiToPitch({ midi: 60 });
    expect(scientific.ok).toBe(true);
    if (scientific.ok) {
      expect(scientific.name).toBe("C4");
      expect(scientific.octaveConvention).toBe("scientific");
    }
    const yamaha = midiToPitch({ midi: 60, octaveConvention: "yamaha" });
    expect(yamaha.ok).toBe(true);
    if (yamaha.ok) {
      expect(yamaha.name).toBe("C3");
      expect(yamaha.octaveConvention).toBe("yamaha");
    }
    // Reading a name back under Yamaha must round-trip to the same MIDI number.
    const parsed = pitchFromName({ name: "C3", octaveConvention: "yamaha" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.midi).toBe(60);
  });

  it("refuses an unrecognised octaveConvention rather than silently defaulting to scientific", () => {
    // The renderer is untrusted (SEC-EL): a third option here must be refused,
    // not folded into "scientific" by the `convention === "yamaha" ? 2 : 1"
    // fallback that every valid call relies on.
    expect(
      midiToPitch({ midi: 60, octaveConvention: "sonar" as unknown as "scientific" }),
    ).toEqual({ ok: false, reason: "octaveConvention" });
    expect(
      pitchFromName({ name: "C4", octaveConvention: "sonar" as unknown as "scientific" }),
    ).toEqual({ ok: false, reason: "octaveConvention" });
    expect(
      pitchFromFrequency({ frequency: 440, octaveConvention: "sonar" as unknown as "scientific" }),
    ).toEqual({ ok: false, reason: "octaveConvention" });
  });

  it("secondFrequency reports the interval to it — absorbing the retired cents/ratio tool", () => {
    // A4 (440 Hz) to 880 Hz is exactly one octave: 1200 cents, ratio 2, beat 440 Hz.
    const result = midiToPitch({ midi: 69, secondFrequency: 880 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intervalToSecond?.cents).toBeCloseTo(1200, 6);
    expect(result.intervalToSecond?.ratio).toBeCloseTo(2, 6);
    expect(result.intervalToSecond?.beatHz).toBeCloseTo(440, 6);
    // `intervalToSecond` is a NESTED value object built from a `ProResult`
    // internally, which carries `ok: true` as a real enumerable property; it
    // must not leak that discriminant onto a field that has no `ok` of its own.
    expect(Object.keys(result.intervalToSecond ?? {}).sort()).toEqual(
      ["baseFrequency", "beatHz", "cents", "ratio", "resultFrequency", "semitones"].sort(),
    );
  });

  it("pitchShiftCents reports this pitch shifted and re-spelled — +100 cents on A4 is exactly A#4", () => {
    const result = midiToPitch({ midi: 69, pitchShiftCents: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shifted?.midi).toBe(70);
    expect(result.shifted?.name).toBe("A#4");
    expect(result.shifted?.cents).toBeCloseTo(0, 6);
  });

  it("pitchFromFrequency's extras use the MEASURED frequency, not the nearest note's — the double-counted-detune bug", () => {
    // mExact = 69 + 12*log2(100/440) = 43.349958 (as the earlier G2 test
    // derives); nearest = 43 (G2), whose OWN frequency is f(43) = 97.998859 Hz
    // -- the quantised note, not the 100 Hz actually typed. secondFrequency of
    // 200 against the TYPED 100 Hz is exactly one octave: 1200.000 cents,
    // ratio 2, beat 100 Hz. Computing it against 97.998859 Hz instead (the
    // bug) double-counts the note's own +34.996 cent detune into the interval.
    const result = pitchFromFrequency({ frequency: 100, secondFrequency: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intervalToSecond?.cents).toBeCloseTo(1200, 3);
    expect(result.intervalToSecond?.ratio).toBeCloseTo(2, 6);
    expect(result.intervalToSecond?.beatHz).toBeCloseTo(100, 3);

    // pitchShiftCents of +1200 must shift the TYPED 100 Hz to 200 Hz, whose own
    // midiExact is 69 + 12*log2(200/440) = 55.349958 -- exactly 12 more than
    // 43.349958, since 200 Hz is one octave above 100 Hz. The bug instead
    // shifts 97.998859 Hz (the nearest note to 100 Hz) to 195.997718 Hz, a
    // visibly different, wrong note.
    const shifted = pitchFromFrequency({ frequency: 100, pitchShiftCents: 1200 });
    expect(shifted.ok).toBe(true);
    if (!shifted.ok) return;
    expect(shifted.shifted?.midiExact).toBeCloseTo(55.349958, 4);
  });

  it("a spelling outside 0..127 is reported as it is, never clamped", () => {
    // Cbb-1: (octave -1 + 1)*12 + natural(C=0) + accidental(-2) = 0 + 0 - 2 = -2
    const result = pitchFromName({ name: "Cbb-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.midi).toBe(-2);
    expect(result.outsideMidiRange).toBe(true);
  });

  it("refuses rather than repairs: an out-of-range reference, MIDI, frequency, malformed name, second frequency and cent shift", () => {
    expect(midiToPitch({ midi: 60, referencePitch: 1000 })).toEqual({
      ok: false,
      reason: "referencePitch",
    });
    expect(midiToPitch({ midi: 128 })).toEqual({ ok: false, reason: "midi" });
    expect(midiToPitch({ midi: 60.5 })).toEqual({ ok: false, reason: "midi" });
    expect(pitchFromName({ name: "H4" })).toEqual({ ok: false, reason: "name" });
    expect(pitchFromFrequency({ frequency: 0 })).toEqual({ ok: false, reason: "frequency" });
    expect(midiToPitch({ midi: 69, secondFrequency: -1 })).toEqual({
      ok: false,
      reason: "secondFrequency",
    });
    expect(midiToPitch({ midi: 69, pitchShiftCents: 20000 })).toEqual({
      ok: false,
      reason: "pitchShiftCents",
    });
  });
});

describe("centsRatio", () => {
  it("an octave is exactly 1200 cents and a ratio of 2", () => {
    const result = centsRatio({ entry: { kind: "frequencies", a: 440, b: 880 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cents).toBeCloseTo(1200, 6);
    expect(result.ratio).toBeCloseTo(2, 6);
    expect(result.semitones).toBeCloseTo(12, 6);
    // 440 -> 880 is a base of 440 by construction; beat = |440*(2-1)| = 440 Hz.
    expect(result.beatHz).toBeCloseTo(440, 6);
  });

  it("440 -> 442 Hz is +7.851 cents, a 2 Hz difference that reads very differently at higher pitch", () => {
    // ratio = 442/440 = 1.004545455; cents = 1200*log2(1.004545455) = 7.851415
    const result = centsRatio({ entry: { kind: "frequencies", a: 440, b: 442 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cents).toBeCloseTo(7.851415, 5);
    expect(result.beatHz).toBeCloseTo(2, 6);
  });

  it("a ratio entry has its own cents formula: cents = 1200*log2(ratio)", () => {
    // cents = +100 -> ratio = 2^(1/12) = 1.059463; applied to C4 gives C#4 = 277.183 Hz
    const fromCents = centsRatio({ entry: { kind: "cents", value: 100 }, baseFrequency: 261.6255653 });
    expect(fromCents.ok).toBe(true);
    if (!fromCents.ok) return;
    expect(fromCents.ratio).toBeCloseTo(1.059463, 6);
    expect(fromCents.resultFrequency).toBeCloseTo(277.183, 3);
    // beatHz = resultFrequency - baseFrequency = 277.1826 - 261.6256 = 15.557
    expect(fromCents.beatHz).toBeCloseTo(15.557, 2);

    // And the ratio entry point must invert it: 1.059463 -> +100.00 cents.
    const fromRatio = centsRatio({ entry: { kind: "ratio", value: 1.059463094359295 } });
    expect(fromRatio.ok).toBe(true);
    if (fromRatio.ok) expect(fromRatio.cents).toBeCloseTo(100, 3);
  });

  it("-14 cents on 440 Hz gives 436.456 Hz", () => {
    // 2^(-14/1200) = 0.9919455; 440*0.9919455 = 436.4561927
    const result = centsRatio({ entry: { kind: "cents", value: -14 }, baseFrequency: 440 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resultFrequency).toBeCloseTo(436.456, 3);
  });

  it("the -12000..12000 range applies only to a TYPED cents value, never to a computed one", () => {
    // ratio 1e6 -> cents = 1200*log2(1e6) = 1200*19.931569 = 23917.88, far past 12000
    // and reported as it is, not rejected.
    const result = centsRatio({ entry: { kind: "ratio", value: 1e6 } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cents).toBeGreaterThan(12000);
  });

  it("refuses rather than repairs: non-positive frequencies and ratio, an out-of-range typed cents figure", () => {
    expect(centsRatio({ entry: { kind: "frequencies", a: 0, b: 880 } })).toEqual({
      ok: false,
      reason: "frequencyA",
    });
    expect(centsRatio({ entry: { kind: "frequencies", a: 440, b: -1 } })).toEqual({
      ok: false,
      reason: "frequencyB",
    });
    expect(centsRatio({ entry: { kind: "ratio", value: 0 } })).toEqual({ ok: false, reason: "ratio" });
    expect(centsRatio({ entry: { kind: "cents", value: 13000 } })).toEqual({
      ok: false,
      reason: "cents",
    });
    expect(centsRatio({ entry: { kind: "cents", value: 0 }, baseFrequency: -1 })).toEqual({
      ok: false,
      reason: "baseFrequency",
    });
  });
});

describe("barDuration / barsInDuration", () => {
  it("140 BPM, 4/4, 32 bars is 54.857 s", () => {
    // secondsPerBeatUnit = (60/140)*(4/4) = 0.428571429; secondsPerBar = 1.714285714
    // total = 32*1.714285714 = 54.857142857
    const result = barDuration({ bpm: 140, numerator: 4, denominator: 4, bars: 32 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seconds).toBeCloseTo(54.857143, 5);
    // The assignment's own computation rule zero-pads BOTH minutes and seconds
    // to two digits ("minutes and seconds are zero-padded to two digits"); its
    // test-vector prose writes the casual "0:54.857" but the rule itself, and
    // the same formatter's "04:08:33" elsewhere, both say "00".
    expect(result.formatted).toBe("00:54.857");
  });

  it("90 BPM, 6/8, 16 bars, BPM counting quarters (the default) is 32.000 s", () => {
    // secondsPerBeatUnit = (60/90)*(4/8) = 0.333333; secondsPerBar = 6*0.333333 = 2.000
    const result = barDuration({ bpm: 90, numerator: 6, denominator: 8, bars: 16 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seconds).toBeCloseTo(32, 3);
  });

  it("the SAME 90 BPM/6/8/16-bar case reads completely differently under the other two BPM references", () => {
    // dotted-quarter: one beat IS 1.5 quarters, so a beat unit lasts
    // (60/90/1.5)*(4/8) = 0.222222*0.5 = 0.222222 s/bar-unit; secondsPerBar = 1.333333
    // 16 bars = 21.333 s.
    const dotted = barDuration({
      bpm: 90,
      numerator: 6,
      denominator: 8,
      bars: 16,
      bpmReference: "dotted-quarter",
    });
    expect(dotted.ok).toBe(true);
    if (dotted.ok) expect(dotted.seconds).toBeCloseTo(21.333333, 4);

    // denominator-unit: the beat IS the eighth note, so a beat lasts exactly
    // 60/90 = 0.666667 s regardless of the time signature; secondsPerBar = 4.000
    // 16 bars = 64.000 s.
    const unit = barDuration({
      bpm: 90,
      numerator: 6,
      denominator: 8,
      bars: 16,
      bpmReference: "denominator-unit",
    });
    expect(unit.ok).toBe(true);
    if (unit.ok) expect(unit.seconds).toBeCloseTo(64, 3);
  });

  it("the inverse direction divides exactly and reports the remainder in beats and ms", () => {
    // 210.000 s at 120 BPM, 4/4: secondsPerBar = 2.000; bars = floor(210/2) = 105; remainder 0
    const exact = barsInDuration({ bpm: 120, numerator: 4, denominator: 4, seconds: 210 });
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect(exact.bars).toBe(105);
      expect(exact.remainderSeconds).toBeCloseTo(0, 6);
    }

    // 100.000 s at 120 BPM, 3/4: secondsPerBar = 1.5; bars = floor(100/1.5) = 66
    // remainder = 100 - 99 = 1.000 s = 1/0.5 = 2.000 doba = 1000 ms
    const withRemainder = barsInDuration({ bpm: 120, numerator: 3, denominator: 4, seconds: 100 });
    expect(withRemainder.ok).toBe(true);
    if (!withRemainder.ok) return;
    expect(withRemainder.bars).toBe(66);
    expect(withRemainder.remainderSeconds).toBeCloseTo(1, 6);
    expect(withRemainder.remainderBeats).toBeCloseTo(2, 6);
    expect(withRemainder.remainderMs).toBeCloseTo(1000, 3);
  });

  it("refuses rather than repairs: BPM, numerator, bar count and duration out of range", () => {
    expect(barDuration({ bpm: 0, numerator: 4, denominator: 4, bars: 1 })).toEqual({
      ok: false,
      reason: "bpm",
    });
    expect(barDuration({ bpm: 120, numerator: 0, denominator: 4, bars: 1 })).toEqual({
      ok: false,
      reason: "numerator",
    });
    expect(barDuration({ bpm: 120, numerator: 4, denominator: 4, bars: -1 })).toEqual({
      ok: false,
      reason: "bars",
    });
    expect(barsInDuration({ bpm: 120, numerator: 4, denominator: 4, seconds: -1 })).toEqual({
      ok: false,
      reason: "seconds",
    });
  });

  it("refuses an untrusted denominator instead of dividing by it: an unchosen select crosses the IPC boundary as 0", () => {
    // TimeSignatureDenominator is a compile-time union only; the renderer is
    // untrusted (SEC-EL) and can hand this an unchosen select's 0. Without the
    // guard, denominator 0 makes secondsPerBar Infinity, and the inverse
    // direction then reads Math.floor(seconds/Infinity) = 0 bars with a NaN
    // remainder instead of a refusal — a wrong answer that looks like one.
    expect(
      barDuration({ bpm: 120, numerator: 4, denominator: 0 as unknown as 4, bars: 1 }),
    ).toEqual({ ok: false, reason: "denominator" });
    expect(
      barsInDuration({ bpm: 120, numerator: 4, denominator: 0 as unknown as 4, seconds: 10 }),
    ).toEqual({ ok: false, reason: "denominator" });
  });

  it("refuses an unrecognised bpmReference rather than silently treating it as quarter", () => {
    expect(
      barDuration({
        bpm: 90,
        numerator: 6,
        denominator: 8,
        bars: 16,
        bpmReference: "half" as unknown as "quarter",
      }),
    ).toEqual({ ok: false, reason: "bpmReference" });
  });

  it("zero bars gives an honest 0.000 s, and a fractional bar count is a real edit point", () => {
    const zero = barDuration({ bpm: 120, numerator: 4, denominator: 4, bars: 0 });
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.seconds).toBe(0);
    // secondsPerBar = 2.000; 2.5 bars = 5.000 s
    const fractional = barDuration({ bpm: 120, numerator: 4, denominator: 4, bars: 2.5 });
    expect(fractional.ok).toBe(true);
    if (fractional.ok) expect(fractional.seconds).toBeCloseTo(5, 6);
  });
});

describe("delayTimes / delayTimesFromMeasuredMs", () => {
  it("120 BPM: beat 500.000 ms, eighth 250.000, dotted eighth 375.000, triplet quarter 333.333", () => {
    const result = delayTimes({ bpm: 120 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.beatMs).toBeCloseTo(500, 6);
    const eighth = result.rows.find((row) => row.denominator === 8);
    expect(eighth?.straight.milliseconds).toBeCloseTo(250, 6);
    expect(eighth?.dotted.milliseconds).toBeCloseTo(375, 6);
    const quarter = result.rows.find((row) => row.denominator === 4);
    expect(quarter?.triplet.milliseconds).toBeCloseTo(333.333, 3);
    expect(quarter?.straight.hertz).toBeCloseTo(2, 6);
  });

  it("128 BPM: dotted eighth is exactly 351.5625 ms and must not drift to 351.5625000000001 or lose it in rounding", () => {
    // beatMs = 60000/128 = 468.75; eighth = 468.75*4/8 = 234.375; dotted = 234.375*1.5 = 351.5625
    const result = delayTimes({ bpm: 128 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const eighth = result.rows.find((row) => row.denominator === 8);
    expect(eighth?.dotted.milliseconds).toBeCloseTo(351.5625, 4);
  });

  it("90 BPM: a dotted half is exactly 2000.000 ms — the triplet/dotted fraction form, not a precomputed factor", () => {
    // half = (60000/90)*4/2 = 1333.3333; dotted half = 1333.3333*1.5 = 2000.000 exactly
    const result = delayTimes({ bpm: 90 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const half = result.rows.find((row) => row.denominator === 2);
    expect(half?.dotted.milliseconds).toBeCloseTo(2000, 6);
  });

  it("the inverse direction agrees with delayTimes at the same tempo — the cross-check", () => {
    // 375.000 ms as a dotted eighth is the 120 BPM vector above; must invert back to 120.
    const inverse = delayTimesFromMeasuredMs({ measuredMs: 375 });
    expect(inverse.ok).toBe(true);
    if (!inverse.ok) return;
    const eighthRow = inverse.rows.find((row) => row.denominator === 8);
    expect(eighthRow?.bpm.dottedBpm).toBeCloseTo(120, 3);
    // And 351.5625 ms as a dotted eighth must invert to 128 BPM.
    const inverse2 = delayTimesFromMeasuredMs({ measuredMs: 351.5625 });
    expect(inverse2.ok).toBe(true);
    if (!inverse2.ok) return;
    const eighthRow2 = inverse2.rows.find((row) => row.denominator === 8);
    expect(eighthRow2?.bpm.dottedBpm).toBeCloseTo(128, 3);
  });

  it("refuses rather than repairs: BPM out of range for delayTimes, a non-positive measured time for the inverse", () => {
    expect(delayTimes({ bpm: 0 })).toEqual({ ok: false, reason: "bpm" });
    expect(delayTimes({ bpm: 1000 })).toEqual({ ok: false, reason: "bpm" });
    expect(delayTimesFromMeasuredMs({ measuredMs: 0 })).toEqual({ ok: false, reason: "measuredMs" });
  });

  it("refuses an untrusted selected denominator: the full table is safe, but `selected` divides by the caller's own value", () => {
    // NoteDenominator is a compile-time union only. `rows` is always safe — it
    // iterates the fixed table — but `selected` is built from `input.denominator`,
    // which an unchosen select crosses the IPC boundary as 0. Without the guard,
    // `selected.milliseconds` comes back Infinity and `selected.hertz` comes back
    // 0 — a delay time of infinity and an LFO rate of zero presented as an answer.
    expect(delayTimes({ bpm: 120, denominator: 0 as unknown as 4 })).toEqual({
      ok: false,
      reason: "denominator",
    });
  });
});

describe("soundWavelength", () => {
  it("20 °C, 100 Hz: c = 343.215 m/s, lambda = 3.4321 m (NOT 3.4322 — see the note below)", () => {
    // c = 331.3*sqrt(1+20/273.15) = 331.3*1.0359632 = 343.2146227
    // lambda = 343.2146227/100 = 3.432146227, which rounds to 3.4321 at 4dp
    // (the next digit is 4, not 5) when taken from full precision. The
    // assignment's own correction claims 3.4322 by first rounding c to
    // 343.215 and THEN dividing (343.215/100 = 3.43215 exactly, which ties at
    // the 5th decimal) — a double-rounding artefact that contradicts this same
    // pack's own "no intermediate rounding" rule. This tool never rounds c
    // before dividing, so 3.4321 is the correct answer here.
    const result = soundWavelength({ entry: { kind: "frequency", value: 100 }, temperature: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speedOfSound).toBeCloseTo(343.2146, 3);
    expect(result.wavelength).toBeCloseTo(3.4321, 4);
    expect(result.halfWavelength).toBeCloseTo(1.7161, 4);
    expect(result.quarterWavelength).toBeCloseTo(0.858, 3);
  });

  it("0 °C, 1000 Hz: c is exactly 331.300 m/s and lambda is 0.3313 m", () => {
    const result = soundWavelength({ entry: { kind: "frequency", value: 1000 }, temperature: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speedOfSound).toBeCloseTo(331.3, 6);
    expect(result.wavelength).toBeCloseTo(0.3313, 4);
  });

  it("propagation delay over 10 m at 20 °C is 29.136 ms, and 2.9136 ms per metre", () => {
    // 10/343.2146*1000 = 29.13556; 1000/343.2146 = 2.913607
    const result = soundWavelength({
      entry: { kind: "frequency", value: 100 },
      temperature: 20,
      distance: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delayMs).toBeCloseTo(29.136, 2);
    expect(result.delayPerMetreMs).toBeCloseTo(2.9136, 3);
  });

  it("the inverse: 1.000 m at 20 °C is 343.215 Hz", () => {
    const result = soundWavelength({ entry: { kind: "wavelength", value: 1 }, temperature: 20 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frequency).toBeCloseTo(343.215, 2);
  });

  it("a measured speedOverride bypasses the dry-air model entirely, temperature and all", () => {
    // 340 m/s / 100 Hz = 3.400 m exactly, regardless of a temperature that would
    // otherwise be invalid.
    const result = soundWavelength({
      entry: { kind: "frequency", value: 100 },
      temperature: 9999,
      speedOverride: 340,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.speedOfSound).toBe(340);
      expect(result.wavelength).toBeCloseTo(3.4, 6);
    }
  });

  it("refuses rather than repairs: an out-of-range temperature (without an override), a non-positive override, frequency or wavelength", () => {
    expect(soundWavelength({ entry: { kind: "frequency", value: 100 }, temperature: 9999 })).toEqual({
      ok: false,
      reason: "temperature",
    });
    expect(
      soundWavelength({ entry: { kind: "frequency", value: 100 }, speedOverride: -1 }),
    ).toEqual({ ok: false, reason: "speedOverride" });
    expect(soundWavelength({ entry: { kind: "frequency", value: 0 } })).toEqual({
      ok: false,
      reason: "frequency",
    });
    expect(soundWavelength({ entry: { kind: "wavelength", value: 0 } })).toEqual({
      ok: false,
      reason: "wavelength",
    });
  });
});

describe("reverbTime", () => {
  const uniformSurface = (area: number, alpha: number) => ({
    area,
    alpha125: alpha,
    alpha250: alpha,
    alpha500: alpha,
    alpha1000: alpha,
    alpha2000: alpha,
    alpha4000: alpha,
  });

  it("V=100 m³, A=20 m² sabins (area 100, alpha 0.2 on every band), 20 °C: Sabine 0.805 s on every band", () => {
    // Sabine = 55.26204*100/(343.2146*20) = 5526.204/6864.292 = 0.8050654
    const result = reverbTime({ volume: 100, surfaces: [uniformSurface(100, 0.2)], temperature: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const band of result.bands) {
      expect(band.sabine).toBeCloseTo(0.805, 3);
      expect(band.averageAlpha).toBeCloseTo(0.2, 6);
    }
    // Eyring: -ln(0.8) = 0.2231436; denom = 343.2146*100*0.2231436 = 7658.615
    // 5526.204/7658.615 = 0.72157
    expect(result.bands[0]?.eyring).toBeCloseTo(0.7216, 3);
  });

  it("room 5x4x2.8 m, alpha 0.15 everywhere: Sabine 0.665 s, Eyring 0.614 s, below Sabine as expected", () => {
    const result = reverbTime({
      volume: 56,
      surfaces: [uniformSurface(90.4, 0.15)],
      temperature: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const band of result.bands) {
      expect(band.sabine).toBeCloseTo(0.665, 3);
      expect(band.eyring).toBeCloseTo(0.614, 3);
      expect(band.eyring ?? 0).toBeLessThan(band.sabine ?? Infinity);
    }
  });

  it("the same room at 0 °C moves the answer to 0.689 s — the temperature is genuinely in the formula", () => {
    const result = reverbTime({ volume: 56, surfaces: [uniformSurface(90.4, 0.15)], temperature: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bands[0]?.sabine).toBeCloseTo(0.689, 3);
  });

  it("the optional air term (Sabine + 4mV) shortens RT60, and is absent without a stated coefficient", () => {
    // Without air: Sabine = 55.26204*1000/(343.2146*20) = 8.050 s (10x the first
    // vector, since V is 10x and A is the same).
    // With air (m=0.005 at every band): airTerm = 4*0.005*1000 = 20; denom =
    // 343.2146*(20+20) = 13728.584; RT = 55262.042/13728.584 = 4.025 s
    const result = reverbTime({
      volume: 1000,
      surfaces: [uniformSurface(200, 0.1)],
      temperature: 20,
      airAbsorption: { at125: 0.005, at250: 0.005, at500: 0.005, at1000: 0.005, at2000: 0.005, at4000: 0.005 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bands[0]?.sabine).toBeCloseTo(8.05, 2);
    expect(result.bands[0]?.sabineWithAir).toBeCloseTo(4.025, 2);

    const noAir = reverbTime({ volume: 1000, surfaces: [uniformSurface(200, 0.1)], temperature: 20 });
    expect(noAir.ok).toBe(true);
    if (noAir.ok) expect(noAir.bands[0]?.sabineWithAir).toBeUndefined();
  });

  it("air absorption is PER BAND, not one figure smeared across all six — the review's own fix demonstrated by hand", () => {
    // Same room as above (V=1000, A=200 m² sabins @ alpha 0.1 on every band,
    // 20 degC, speed 343.2146 m/s), but m is typed ONLY at 4000 Hz (m=0.02,
    // the realistic order of magnitude at that band) and left absent at 125 Hz.
    // 125 Hz: no coefficient typed for this band -> sabineWithAir undefined,
    // regardless of the 4000 Hz figure sitting right beside it in the input.
    // 4000 Hz: airTerm = 4*0.02*1000 = 80; denom = 343.2146*(20+80) = 34321.46
    // RT = 55262.042/34321.46 = 1.610 s -- far below the airless 8.050 s.
    const result = reverbTime({
      volume: 1000,
      surfaces: [uniformSurface(200, 0.1)],
      temperature: 20,
      airAbsorption: { at4000: 0.02 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const band125 = result.bands.find((b) => b.band === 125);
    const band4000 = result.bands.find((b) => b.band === 4000);
    expect(band125?.sabineWithAir).toBeUndefined();
    expect(band125?.sabine).toBeCloseTo(8.05, 2); // the plain figure is untouched
    expect(band4000?.sabineWithAir).toBeCloseTo(1.61, 2);
  });

  it("six DISTINCT alphas catch a REVERB_ALPHA_FIELD transposition that a uniform surface cannot", () => {
    // area=100, alpha rising 0.1..0.6 by band: A = 10,20,30,40,50,60 m² sabins.
    // K = numerator/speed = (55.26204223*100)/343.2146227 = 16.101308 (V=100,
    // 20 degC); Sabine(A) = K/A, so each band has its OWN distinct answer, and
    // reading band1000's alpha off alpha500 (say) would print band1000 as
    // 0.536710 s instead of the right 0.402533 s -- a transposition a
    // uniform-alpha surface can never expose, since every band would agree
    // regardless of which field the lookup actually read.
    const result = reverbTime({
      volume: 100,
      surfaces: [
        { area: 100, alpha125: 0.1, alpha250: 0.2, alpha500: 0.3, alpha1000: 0.4, alpha2000: 0.5, alpha4000: 0.6 },
      ],
      temperature: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expectedAlpha: Record<number, number> = {
      125: 0.1,
      250: 0.2,
      500: 0.3,
      1000: 0.4,
      2000: 0.5,
      4000: 0.6,
    };
    const expectedSabine: Record<number, number> = {
      125: 1.610131,
      250: 0.805065,
      500: 0.53671,
      1000: 0.402533,
      2000: 0.322026,
      4000: 0.268355,
    };
    for (const band of result.bands) {
      expect(band.averageAlpha).toBeCloseTo(expectedAlpha[band.band] ?? 0, 6);
      expect(band.sabine).toBeCloseTo(expectedSabine[band.band] ?? 0, 4);
    }
  });

  it("each octave band is independent: a band with zero absorption has no Sabine figure while its neighbours do", () => {
    const result = reverbTime({
      volume: 100,
      surfaces: [
        {
          area: 50,
          alpha125: 0,
          alpha250: 0.1,
          alpha500: 0.1,
          alpha1000: 0.1,
          alpha2000: 0.1,
          alpha4000: 0.1,
        },
      ],
      temperature: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const band125 = result.bands.find((b) => b.band === 125);
    const band250 = result.bands.find((b) => b.band === 250);
    expect(band125?.sabine).toBeUndefined();
    expect(band250?.sabine).toBeDefined();
  });

  it("alphaBar = 1 (anechoic limit): Sabine still returns a finite figure, Eyring has none — reported, not papered over", () => {
    const result = reverbTime({ volume: 100, surfaces: [uniformSurface(50, 1)], temperature: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bands[0]?.sabine).toBeDefined();
    expect(result.bands[0]?.eyring).toBeUndefined();
  });

  it("refuses rather than repairs: non-positive volume, no surfaces, non-positive area, an out-of-range alpha or air coefficient", () => {
    expect(reverbTime({ volume: 0, surfaces: [uniformSurface(50, 0.2)] })).toEqual({
      ok: false,
      reason: "volume",
    });
    expect(reverbTime({ volume: 100, surfaces: [] })).toEqual({ ok: false, reason: "surfaces" });
    expect(reverbTime({ volume: 100, surfaces: [uniformSurface(0, 0.2)] })).toEqual({
      ok: false,
      reason: "area",
    });
    expect(reverbTime({ volume: 100, surfaces: [uniformSurface(50, 1.5)] })).toEqual({
      ok: false,
      reason: "alpha125",
    });
    expect(
      reverbTime({
        volume: 100,
        surfaces: [uniformSurface(50, 0.2)],
        airAbsorption: { at4000: -1 },
      }),
    ).toEqual({ ok: false, reason: "at4000" });
  });
});

describe("roomModes", () => {
  it("5x4x2.8 m room at 20 °C: the three axial modes along each dimension", () => {
    // c/2 = 343.2146/2 = 171.6073
    // (1,0,0) = 171.6073/5 = 34.32; (0,1,0) = 171.6073/4 = 42.90; (0,0,1) = 171.6073/2.8 = 61.29
    const result = roomModes({ length: 5, width: 4, height: 2.8, frequencyLimit: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mode100 = result.modes.find((m) => m.p === 1 && m.q === 0 && m.r === 0);
    const mode010 = result.modes.find((m) => m.p === 0 && m.q === 1 && m.r === 0);
    const mode001 = result.modes.find((m) => m.p === 0 && m.q === 0 && m.r === 1);
    expect(mode100?.frequency).toBeCloseTo(34.32, 1);
    expect(mode100?.type).toBe("axial");
    expect(mode010?.frequency).toBeCloseTo(42.9, 1);
    expect(mode001?.frequency).toBeCloseTo(61.29, 1);
  });

  it("the (1,1,0) tangential and (1,1,1) oblique modes of the same room", () => {
    // sqrt(1/25 + 1/16) = sqrt(0.1025) = 0.3201562; f = 171.6073*0.3201562 = 54.94
    // sqrt(0.04+0.0625+1/7.84) = sqrt(0.230051) = 0.4796363; f = 82.31
    const result = roomModes({ length: 5, width: 4, height: 2.8, frequencyLimit: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tangential = result.modes.find((m) => m.p === 1 && m.q === 1 && m.r === 0);
    const oblique = result.modes.find((m) => m.p === 1 && m.q === 1 && m.r === 1);
    expect(tangential?.type).toBe("tangential");
    expect(tangential?.frequency).toBeCloseTo(54.94, 1);
    expect(oblique?.type).toBe("oblique");
    expect(oblique?.frequency).toBeCloseTo(82.31, 1);
  });

  it("a cubic room shows the threefold degeneracy as two 0.00 Hz spacings, not deduplicated away", () => {
    const result = roomModes({ length: 4, width: 4, height: 4, frequencyLimit: 50, maxOrder: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const axialModes = result.modes.filter(
      (m) => (m.p === 1 && m.q === 0 && m.r === 0) || (m.p === 0 && m.q === 1 && m.r === 0) || (m.p === 0 && m.q === 0 && m.r === 1),
    );
    expect(axialModes).toHaveLength(3);
    expect(axialModes.every((m) => Math.abs(m.frequency - (axialModes[0]?.frequency ?? 0)) < 1e-9)).toBe(
      true,
    );
    // At least one of the three consecutive rows must show a 0.00 Hz spacing.
    const sorted = [...result.modes].sort((a, b) => a.frequency - b.frequency);
    const zeroSpacingCount = sorted.filter((m) => m.spacing !== undefined && m.spacing < 1e-9).length;
    expect(zeroSpacingCount).toBeGreaterThanOrEqual(2);
  });

  it("the first mode in the sorted list carries no spacing", () => {
    const result = roomModes({ length: 5, width: 4, height: 2.8, frequencyLimit: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.modes[0]?.spacing).toBeUndefined();
  });

  it("refuses rather than repairs: dimensions, temperature, frequency limit and mode order out of range", () => {
    expect(roomModes({ length: 0, width: 4, height: 2.8 })).toEqual({ ok: false, reason: "length" });
    expect(roomModes({ length: 5, width: 4, height: 2.8, temperature: 9999 })).toEqual({
      ok: false,
      reason: "temperature",
    });
    expect(roomModes({ length: 5, width: 4, height: 2.8, frequencyLimit: 5 })).toEqual({
      ok: false,
      reason: "frequencyLimit",
    });
    expect(roomModes({ length: 5, width: 4, height: 2.8, maxOrder: 20 })).toEqual({
      ok: false,
      reason: "maxOrder",
    });
  });
});

describe("speakerLoad", () => {
  it("two 8 ohm cabinets in parallel: 4.0000 ohm, and 400 W splits 50/50", () => {
    const result = speakerLoad({
      cabinets: [{ impedance: 8 }, { impedance: 8 }],
      wiring: "parallel",
      power: 400,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalImpedance).toBeCloseTo(4, 4);
    // V = sqrt(400*4) = 40.0000; each cabinet: 40^2/8 = 200.000 W
    expect(result.driveVoltage).toBeCloseTo(40, 4);
    expect(result.cabinets[0]?.power).toBeCloseTo(200, 3);
    expect(result.cabinets[0]?.sharePercent).toBeCloseTo(50, 2);
  });

  it("8 + 16 ohm in parallel: unequal split proportional to conductance, summing back to the stated power", () => {
    // Ztotal = 1/(0.125+0.0625) = 5.3333; V = sqrt(300*5.333333) = sqrt(1600) = 40.0000
    const result = speakerLoad({
      cabinets: [{ impedance: 8 }, { impedance: 16 }],
      wiring: "parallel",
      power: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalImpedance).toBeCloseTo(5.3333, 3);
    expect(result.driveVoltage).toBeCloseTo(40, 4);
    // 8 ohm: 1600/8 = 200.000 W (66.67%); 16 ohm: 1600/16 = 100.000 W (33.33%)
    expect(result.cabinets[0]?.power).toBeCloseTo(200, 3);
    expect(result.cabinets[1]?.power).toBeCloseTo(100, 3);
    expect((result.cabinets[0]?.power ?? 0) + (result.cabinets[1]?.power ?? 0)).toBeCloseTo(300, 2);
  });

  it("two 8 ohm cabinets in series: 16.0000 ohm, and equal current gives an equal split", () => {
    // I = sqrt(200/16) = 3.5355 A; each = I^2*8 = 12.5*8 = 100.000 W
    const result = speakerLoad({
      cabinets: [{ impedance: 8 }, { impedance: 8 }],
      wiring: "series",
      power: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalImpedance).toBeCloseTo(16, 4);
    expect(result.cabinets[0]?.power).toBeCloseTo(100, 3);
  });

  it("with a typed minimum rated load, the pane shows the ratio and nothing more — no verdict field exists to check", () => {
    // Three 8 ohm in parallel: Ztotal = 1/(3/8) = 2.6667 ohm; ratio against 4 ohm = 0.6667
    const result = speakerLoad({
      cabinets: [{ impedance: 8 }, { impedance: 8 }, { impedance: 8 }],
      wiring: "parallel",
      minimumLoad: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalImpedance).toBeCloseTo(2.6667, 3);
    expect(result.loadRatio).toBeCloseTo(0.6667, 3);
    expect(result.minimumLoad).toBe(4);
  });

  it("without a stated minimum load, the ratio is undefined — an absent rule is not a satisfied one", () => {
    const result = speakerLoad({ cabinets: [{ impedance: 8 }], wiring: "parallel" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.loadRatio).toBeUndefined();
  });

  it("refuses rather than repairs: too few/many cabinets, a non-positive impedance, a missing series-parallel group", () => {
    expect(speakerLoad({ cabinets: [], wiring: "parallel" })).toEqual({
      ok: false,
      reason: "cabinets",
    });
    expect(speakerLoad({ cabinets: [{ impedance: 0 }], wiring: "parallel" })).toEqual({
      ok: false,
      reason: "impedance",
    });
    expect(
      speakerLoad({ cabinets: [{ impedance: 8 }, { impedance: 8 }], wiring: "series-parallel" }),
    ).toEqual({ ok: false, reason: "group" });
  });

  it("refuses a non-positive minimum rated load rather than echoing it beside an undefined ratio", () => {
    // regulated tier: the amplifier's own figure, typed with no default. A zero
    // or negative value is not "no limit typed" (that is `undefined`, already
    // covered above) — it is a bad number the surface must not print as if it
    // were the manufacturer's.
    expect(
      speakerLoad({ cabinets: [{ impedance: 8 }], wiring: "parallel", minimumLoad: 0 }),
    ).toEqual({ ok: false, reason: "minimumLoad" });
    expect(
      speakerLoad({ cabinets: [{ impedance: 8 }], wiring: "parallel", minimumLoad: -4 }),
    ).toEqual({ ok: false, reason: "minimumLoad" });
  });
});

describe("splAtDistance", () => {
  it("96 dB @1W/1m, 500 W, 20 m: 96.97 dB", () => {
    // 96 + 10*log10(500) - 20*log10(20) = 96 + 26.9897 - 26.0206 = 96.9691
    const result = splAtDistance({ sensitivity: 96, power: 500, distance: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.level).toBeCloseTo(96.97, 1);
  });

  it("doubling the distance three times from 1 m to 8 m loses 18.06 dB — three 6.0206 dB steps", () => {
    const result = splAtDistance({ sensitivity: 96, power: 500, distance: 1, secondDistance: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secondDifferenceDb).toBeCloseTo(-18.0618, 3);
  });

  it("101 dB @1W/1m, 1000 W, 30 m: 101.46 dB", () => {
    const result = splAtDistance({ sensitivity: 101, power: 1000, distance: 30 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.level).toBeCloseTo(101.46, 1);
  });

  it("with a typed limit, the pane shows the computed level, the limit and their difference — nothing more", () => {
    const result = splAtDistance({ sensitivity: 96, power: 500, distance: 20, limit: 95 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.limitDifferenceDb).toBeCloseTo(1.97, 1);
    expect(result.limit).toBe(95);
  });

  it("without a limit, the difference is undefined rather than assuming compliance", () => {
    const result = splAtDistance({ sensitivity: 96, power: 500, distance: 20 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.limitDifferenceDb).toBeUndefined();
  });

  it("a 2.83V/1m sensitivity on a 4 ohm cabinet overstates the 1W figure by 3.01 dB", () => {
    // 2.83 V into 4 ohm is 2 W, not 1 W: sensitivity1W = 90 - 10*log10(8/4) = 90 - 3.0103 = 86.9897
    const result = splAtDistance({
      sensitivity: 90,
      sensitivityReference: "2.83v",
      nominalImpedance: 4,
      power: 1,
      distance: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sensitivity1W).toBeCloseTo(86.9897, 3);
  });

  it("refuses rather than repairs: sensitivity, power, distance out of range, and a missing nominal impedance for a 2.83V rating", () => {
    expect(splAtDistance({ sensitivity: 50, power: 1, distance: 1 })).toEqual({
      ok: false,
      reason: "sensitivity",
    });
    expect(splAtDistance({ sensitivity: 96, power: 0, distance: 1 })).toEqual({
      ok: false,
      reason: "power",
    });
    expect(splAtDistance({ sensitivity: 96, power: 1, distance: 0 })).toEqual({
      ok: false,
      reason: "distance",
    });
    expect(
      splAtDistance({
        sensitivity: 90,
        sensitivityReference: "2.83v",
        power: 1,
        distance: 1,
      }),
    ).toEqual({ ok: false, reason: "nominalImpedance" });
  });

  it("refuses an out-of-range limit rather than echoing it beside a difference computed against a bad number", () => {
    // regulated tier, 0..140 dB: a limit of -300 is not "no limit typed" (that
    // is `undefined`, covered above) — it is a bad figure, and printing it next
    // to the computed level would be exactly the repair-by-omission this file
    // otherwise refuses everywhere else.
    expect(
      splAtDistance({ sensitivity: 96, power: 500, distance: 20, limit: -300 }),
    ).toEqual({ ok: false, reason: "limit" });
    expect(
      splAtDistance({ sensitivity: 96, power: 500, distance: 20, limit: 200 }),
    ).toEqual({ ok: false, reason: "limit" });
  });

  it("refuses an unrecognised sensitivityReference rather than silently reading it as 1 W", () => {
    expect(
      splAtDistance({
        sensitivity: 90,
        sensitivityReference: "4v" as unknown as "1w",
        power: 1,
        distance: 1,
      }),
    ).toEqual({ ok: false, reason: "sensitivityReference" });
  });
});

describe("pcmSize / pcmDuration", () => {
  it("3:45, 44100 Hz, 16-bit, 2ch: the CD bitrate and both size prefix families", () => {
    // bytesPerSecond = 44100*2*2 = 176400; total = 176400*225 = 39690000 B
    const result = pcmSize({ seconds: 225, sampleRate: 44100, bitDepth: 16, channels: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(39690000);
    expect(result.megabytes).toBeCloseTo(39.69, 3);
    expect(result.mebibytes).toBeCloseTo(37.851, 3);
    expect(result.bitrateKbps).toBeCloseTo(1411.2, 1);
    expect(result.exceedsWav32BitRange).toBe(false);
  });

  it("1 hour, 96000 Hz, 24-bit, 8ch: 7.725 GiB, and it EXCEEDS the 32-bit RIFF size field", () => {
    // bytesPerSecond = 96000*3*8 = 2304000; total = 2304000*3600 = 8294400000
    const result = pcmSize({ seconds: 3600, sampleRate: 96000, bitDepth: 24, channels: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(8294400000);
    expect(result.gibibytes).toBeCloseTo(7.725, 3);
    expect(result.bitrateKbps).toBeCloseTo(18432, 1);
    expect(result.exceedsWav32BitRange).toBe(true);
  });

  it("the inverse: 4.000 GiB at 48000 Hz/24-bit/2ch is 04:08:33.081", () => {
    // bytesPerSecond = 48000*3*2 = 288000; 4294967296/288000 = 14913.081 s
    const result = pcmDuration({
      bytes: 4 * 2 ** 30,
      sampleRate: 48000,
      bitDepth: 24,
      channels: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 16777216/1125 = 14913 + 91/1125 = 14913.0808888... — the assignment's own
    // vector rounds this naively to .081, but its OWN formatting rule (shared
    // by this formatter across bar-duration/PCM/varispeed) truncates the
    // milliseconds field toward zero rather than rounding it, which gives .080.
    expect(result.seconds).toBeCloseTo(14913.0809, 3);
    expect(result.formatted).toBe("04:08:33.080");
  });

  it("the WAV header is per FILE: 4 tracks add 44*4 = 176 B, not 44", () => {
    // 176400*10*4 = 7056000; +176 = 7056176 B = 7.056 MB
    const result = pcmSize({
      seconds: 10,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      tracks: 4,
      includeHeader: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(7056176);
    expect(result.headerBytes).toBe(176);
    expect(result.megabytes).toBeCloseTo(7.056, 3);
  });

  it("refuses rather than repairs: sample rate, channels, tracks, seconds and a size too small to hold the headers", () => {
    expect(pcmSize({ seconds: 1, sampleRate: 500, bitDepth: 16, channels: 2 })).toEqual({
      ok: false,
      reason: "sampleRate",
    });
    expect(pcmSize({ seconds: 1, sampleRate: 44100, bitDepth: 16, channels: 0 })).toEqual({
      ok: false,
      reason: "channels",
    });
    expect(pcmSize({ seconds: -1, sampleRate: 44100, bitDepth: 16, channels: 2 })).toEqual({
      ok: false,
      reason: "seconds",
    });
    expect(
      pcmDuration({
        bytes: 10,
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        includeHeader: true,
      }),
    ).toEqual({ ok: false, reason: "bytes" });
  });

  it("refuses an untrusted bit depth instead of dividing by it: an unchosen select crosses the IPC boundary as 0", () => {
    // BitDepth is a compile-time union only. bytesPerSample = bitDepth/8 feeds
    // bytesPerSecond, the DIVISOR on the pcmDuration side; without this guard a
    // bitDepth of 0 makes bytesPerSecond 0, so pcmSize silently answers 0 bytes
    // for "nothing typed yet" and pcmDuration's seconds comes back Infinity.
    expect(
      pcmSize({ seconds: 1, sampleRate: 44100, bitDepth: 0 as unknown as 16, channels: 2 }),
    ).toEqual({ ok: false, reason: "bitDepth" });
    expect(
      pcmDuration({ bytes: 1000, sampleRate: 44100, bitDepth: 0 as unknown as 16, channels: 2 }),
    ).toEqual({ ok: false, reason: "bitDepth" });
  });
});

describe("bufferLatency / sampleCount / sampleDuration", () => {
  it("256 samples at 48000 Hz: 5.3333 ms one way, 10.6667 ms round trip with no converter latency typed", () => {
    // 256/48000*1000 = 5.333333
    const result = bufferLatency({
      sampleRate: 48000,
      bufferSamples: 256,
      extraInMs: 0,
      extraOutMs: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.oneWayMs).toBeCloseTo(5.3333, 3);
    expect(result.roundTripMs).toBeCloseTo(10.6667, 3);
  });

  it("512 samples at 44100 Hz with 1.5 ms of INPUT latency only: one way in/out differ, round trip is undefined without both", () => {
    // 512/44100*1000 = 11.609977
    const result = bufferLatency({ sampleRate: 44100, bufferSamples: 512, extraInMs: 1.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.oneWayInMs).toBeCloseTo(13.11, 2);
    expect(result.oneWayOutMs).toBeUndefined();
    expect(result.roundTripMs).toBeUndefined();
  });

  it("asymmetric AD/DA latency (0.7 ms in, 0.9 ms out) sums correctly for the round trip", () => {
    // 512/44100*1000 = 11.609977; round trip = 2*11.609977 + 0.7 + 0.9 = 24.81995
    const result = bufferLatency({
      sampleRate: 44100,
      bufferSamples: 512,
      extraInMs: 0.7,
      extraOutMs: 0.9,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.oneWayInMs).toBeCloseTo(12.31, 2);
    expect(result.oneWayOutMs).toBeCloseTo(12.51, 2);
    expect(result.roundTripMs).toBeCloseTo(24.82, 2);
  });

  it("3.5 s at 96000 Hz is exactly 336000 samples", () => {
    const result = sampleCount({ sampleRate: 96000, milliseconds: 3500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.samples).toBe(336000);
    expect(result.wholeSamples).toBe(true);
  });

  it("1 ms at 44100 Hz is 44.1000 samples and is shown as a fraction, not rounded to 44", () => {
    const result = sampleCount({ sampleRate: 44100, milliseconds: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.samples).toBeCloseTo(44.1, 6);
    expect(result.wholeSamples).toBe(false);
  });

  it("441 samples at 44100 Hz is exactly 10.000 ms", () => {
    const result = sampleDuration({ sampleRate: 44100, samples: 441 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.milliseconds).toBeCloseTo(10, 6);
  });

  it("refuses rather than repairs: sample rate and buffer size out of range, out-of-range converter latencies, a non-positive duration", () => {
    expect(bufferLatency({ sampleRate: 500, bufferSamples: 256 })).toEqual({
      ok: false,
      reason: "sampleRate",
    });
    expect(bufferLatency({ sampleRate: 48000, bufferSamples: 0 })).toEqual({
      ok: false,
      reason: "bufferSamples",
    });
    expect(bufferLatency({ sampleRate: 48000, bufferSamples: 256, extraInMs: 1000 })).toEqual({
      ok: false,
      reason: "extraInMs",
    });
    expect(sampleCount({ sampleRate: 44100, milliseconds: 0 })).toEqual({
      ok: false,
      reason: "milliseconds",
    });
    expect(sampleDuration({ sampleRate: 44100, samples: -1 })).toEqual({
      ok: false,
      reason: "samples",
    });
  });
});

describe("varispeed", () => {
  it("44100 Hz material played back at 48000 Hz runs 8.8% faster", () => {
    // r = 48000/44100 = 1.088435; cents = 1200*log2(1.088435) = 146.71
    const result = varispeed({
      entry: { kind: "sampleRates", recordedAtHz: 44100, playedBackAtHz: 48000 },
      tempo: 120,
      lengthSeconds: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(1.088435, 5);
    expect(result.cents).toBeCloseTo(146.71, 1);
    expect(result.semitones).toBeCloseTo(1.4671, 3);
    expect(result.tempo).toBeCloseTo(130.612, 2);
    expect(result.lengthSeconds).toBeCloseTo(9.188, 2);
  });

  it("the reciprocal reading (a 48k file dropped into a 44.1k session) inverts exactly", () => {
    const result = varispeed({
      entry: { kind: "sampleRates", recordedAtHz: 48000, playedBackAtHz: 44100 },
      lengthSeconds: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(0.91875, 5);
    expect(result.cents).toBeCloseTo(-146.71, 1);
    expect(result.lengthSeconds).toBeCloseTo(10.884, 2);
  });

  it("-2 semitones slows tempo and lengthens a loop", () => {
    // r = 2^(-2/12) = 0.890899
    const result = varispeed({
      entry: { kind: "semitones", value: -2 },
      tempo: 128,
      lengthSeconds: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(0.890899, 5);
    expect(result.cents).toBeCloseTo(-200, 1);
    expect(result.tempo).toBeCloseTo(114.035, 2);
    expect(result.lengthSeconds).toBeCloseTo(8.98, 2);
  });

  it("+12 semitones is the definitional octave: ratio 2, double the tempo, half the length", () => {
    const result = varispeed({ entry: { kind: "semitones", value: 12 }, tempo: 100, lengthSeconds: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(2, 6);
    expect(result.tempo).toBeCloseTo(200, 3);
    expect(result.lengthSeconds).toBeCloseTo(2, 6);
  });

  it("refuses rather than repairs: out-of-range semitones/cents, a non-positive ratio or sample rate, out-of-range tempo/length", () => {
    expect(varispeed({ entry: { kind: "semitones", value: 100 } })).toEqual({
      ok: false,
      reason: "semitones",
    });
    expect(varispeed({ entry: { kind: "ratio", value: 0 } })).toEqual({ ok: false, reason: "ratio" });
    expect(
      varispeed({ entry: { kind: "sampleRates", recordedAtHz: 500, playedBackAtHz: 48000 } }),
    ).toEqual({ ok: false, reason: "recordedAtHz" });
    expect(varispeed({ entry: { kind: "ratio", value: 1 }, tempo: 0 })).toEqual({
      ok: false,
      reason: "tempo",
    });
    expect(varispeed({ entry: { kind: "ratio", value: 1 }, lengthSeconds: -1 })).toEqual({
      ok: false,
      reason: "lengthSeconds",
    });
  });
});

describe("spellScale", () => {
  it("F# major has six sharps: F# G# A# B C# D# E#", () => {
    const result = spellScale({ root: "F#", scale: "major" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((n) => n.name)).toEqual(["F#", "G#", "A#", "B", "C#", "D#", "E#"]);
    expect(result.keySignature).toEqual({ sharps: 6, flats: 0, mixed: false });
    expect(result.keySignatureIsRelative).toBe(false);
  });

  it("Eb natural minor has six flats and spells its sixth degree Cb, not B", () => {
    const result = spellScale({ root: "Eb", scale: "natural-minor" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((n) => n.name)).toEqual(["Eb", "F", "Gb", "Ab", "Bb", "Cb", "Db"]);
    expect(result.keySignature).toEqual({ sharps: 0, flats: 6, mixed: false });
  });

  it("C blues spells its b5 and 5 on the SAME letter G — the letter-step array a degree-index shortcut cannot produce", () => {
    const result = spellScale({ root: "C", scale: "blues" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((n) => n.name)).toEqual(["C", "Eb", "F", "Gb", "G", "Bb"]);
  });

  it("A harmonic minor's signature is the RELATIVE NATURAL MINOR's (0/0), not a self-count that mistakes the raised 7th for a sharp", () => {
    // A harmonic minor = A B C D E F G#. A naive self-count would see one sharp
    // (G#) and print „1 sharp", which is not a key signature anyone uses.
    const result = spellScale({ root: "A", scale: "harmonic-minor" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((n) => n.name)).toEqual(["A", "B", "C", "D", "E", "F", "G#"]);
    expect(result.keySignature).toEqual({ sharps: 0, flats: 0, mixed: false });
    expect(result.keySignatureIsRelative).toBe(true);
  });

  it("D dorian is a true rotation of a major scale, so its own spelled accidentals ARE its parent's signature (0/0) — and the flag now says so", () => {
    // A mode is a rotation of the major scale on the SAME letters, so the
    // number a self-count produces is numerically identical to the parent
    // major's signature; the fix widens `keySignatureIsRelative` to the seven
    // modes because what is printed is the PARENT key's signature (here, C
    // major's), not one D dorian owns — not because the number was wrong.
    const result = spellScale({ root: "D", scale: "dorian" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((n) => n.name)).toEqual(["D", "E", "F", "G", "A", "B", "C"]);
    expect(result.keySignature).toEqual({ sharps: 0, flats: 0, mixed: false });
    expect(result.keySignatureIsRelative).toBe(true);
  });

  it("C lydian's one sharp is G major's signature, not a number of its own — same widened flag, a non-zero case", () => {
    // C lydian: C D E F# G A B (only the 4th is raised). That is exactly the
    // pitch-class content of G major reordered from a different starting
    // letter, so the self-counted "1 sharp" and G major's printed signature
    // are the same fact seen from two roots — which is why the number needed
    // no correction and only the flag did.
    const result = spellScale({ root: "C", scale: "lydian" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((n) => n.name)).toEqual(["C", "D", "E", "F#", "G", "A", "B"]);
    expect(result.keySignature).toEqual({ sharps: 1, flats: 0, mixed: false });
    expect(result.keySignatureIsRelative).toBe(true);
  });

  it("G## major's seventh degree needs a triple accidental, so the key signature is withheld rather than printed as 15 sharps", () => {
    // rootPc = mod12(natural(G)=7 + 2) = 9. Degree 6 (letter step 6 -> F, pc
    // mod12(9+11)=8): accidental = mod12(8 - natural(F)=5 + 6) - 6 = mod12(9) -
    // 6 = 3, i.e. F### — unspellable. A naive sum-of-accidentals over the six
    // spellable degrees plus the raw +3 on the seventh would print "15 sharps"
    // beside a scale the tool has just declared it cannot write; the fix
    // withholds the signature instead, exactly as `transposeKey` already does.
    const result = spellScale({ root: "G##", scale: "major" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes[6]?.accidental).toBe(3);
    expect(result.notes[6]?.name).toBeUndefined();
    expect(result.keySignature).toBeUndefined();
    // The other six degrees ARE spellable — this is a withheld signature, not
    // an unspellable scale.
    expect(result.notes[0]?.name).toBe("G##");
  });

  it("a pentatonic scale has no key signature and no diatonic triads at all", () => {
    const result = spellScale({ root: "C", scale: "major-pentatonic" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keySignature).toBeUndefined();
    expect(result.keySignatureIsRelative).toBe(false);
    expect(result.triads).toBeUndefined();
  });

  it("refuses a malformed root rather than guessing", () => {
    expect(spellScale({ root: "H", scale: "major" })).toEqual({ ok: false, reason: "root" });
  });

  it("refuses an unrecognised scale rather than crashing on an undefined pattern", () => {
    // SCALE_PATTERNS[input.scale] would be `undefined` for anything not in the
    // table, and `pattern.semitones.map` on it throws a TypeError — a crash
    // inside a main-process IPC handler instead of a refusal.
    expect(spellScale({ root: "C", scale: "whole-tone" as unknown as "major" })).toEqual({
      ok: false,
      reason: "scale",
    });
  });
});

describe("spellChord", () => {
  it("C7 spells its seventh on the letter B, giving Bb, never A#", () => {
    const result = spellChord({ root: "C", chord: "7" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notes.map((n) => n.name)).toEqual(["C", "E", "G", "Bb"]);
  });

  it("B diminished seventh is the canonical B D F Ab spelling", () => {
    const result = spellChord({ root: "B", chord: "dim7" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notes.map((n) => n.name)).toEqual(["B", "D", "F", "Ab"]);
  });

  it("a degree needing more than a double accidental is reported unspellable, not renamed enharmonically", () => {
    // Fx (F##, pc 7) augmented triad, offsets 0,4,8 on letter steps 0,2,4:
    // degree0: F## (accidental +2, spellable); degree1: A## (accidental +2, spellable);
    // degree2: letter C, pc mod12(7+8)=3, natural(C)=0, accidental = mod12(3-0+6)-6 = 3
    // -> |3| > 2, unspellable.
    const result = spellChord({ root: "Fx", chord: "aug" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes[2]?.accidental).toBe(3);
    expect(result.notes[2]?.name).toBeUndefined();
  });

  it("refuses a malformed root", () => {
    expect(spellChord({ root: "Z", chord: "maj" })).toEqual({ ok: false, reason: "root" });
  });

  it("refuses an unrecognised chord rather than crashing on an undefined pattern", () => {
    expect(spellChord({ root: "C", chord: "add9" as unknown as "maj" })).toEqual({
      ok: false,
      reason: "chord",
    });
  });

  it("C13 stacks the ninth, eleventh and thirteenth on D, F and A — letterSteps taken mod 7, no octave spelled", () => {
    // "13": semitones [0,4,7,10,14,17,21], letterSteps [0,2,4,6,1,3,5].
    // degree4 (D): step1, semitone14 -> pc mod12(14)=2; natural(D)=2 -> D.
    // degree5 (F): step3, semitone17 -> pc mod12(17)=5; natural(F)=5 -> F.
    // degree6 (A): step5, semitone21 -> pc mod12(21)=9; natural(A)=9 -> A.
    const result = spellChord({ root: "C", chord: "13" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((n) => n.name)).toEqual(["C", "E", "G", "Bb", "D", "F", "A"]);
    // Written as the pattern states it, not reduced into a single octave.
    expect(result.notes[4]?.semitones).toBe(14);
    expect(result.notes[6]?.semitones).toBe(21);
  });
});

describe("transposeText", () => {
  it("C Am F G, up a major second, becomes D Bm G A — quality suffix copied through unchanged", () => {
    const result = transposeText({
      text: "C Am F G",
      by: { kind: "interval", interval: "major-second", direction: "up" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("D Bm G A");
  });

  it("Eb up a minor third is Gb, not F# — a pitch-class-only implementation gets exactly this wrong", () => {
    const result = transposeText({
      text: "Eb",
      by: { kind: "interval", interval: "minor-third", direction: "up" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("Gb");
  });

  it("non-music text passes through untouched", () => {
    const result = transposeText({
      text: "Verse 1 | Bad",
      by: { kind: "interval", interval: "unison", direction: "up" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("Verse 1 | Bad");
  });

  it("refuses text outside the 1..5000 character bound", () => {
    expect(transposeText({ text: "", by: { kind: "interval", interval: "unison", direction: "up" } })).toEqual(
      { ok: false, reason: "text" },
    );
  });

  it("a slash chord transposes both the chord tone and the bass note: C/E up a major second is D/F#", () => {
    // Root C -> D as in the first test above. Bass E: letterIndex 2, pc 4;
    // newLetter 2+1=3 (F), newPc mod12(4+2)=6; accidentalFor(F, pc6) =
    // mod12(6-natural(F)=5+6)-6 = mod12(7)-6 = 1 -> F#.
    const result = transposeText({
      text: "C/E",
      by: { kind: "interval", interval: "major-second", direction: "up" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("D/F#");
    expect(result.unspellable).toBe(0);
  });

  it("an unspellable root increments `unspellable` and keeps its source text unchanged in the output", () => {
    // Gx (G double sharp: accidental +2, pc mod12(natural(G)=7+2)=9) up an
    // augmented fourth (letterStep 3, semitones 6): new letter index 4+3=7 ->
    // mod7=0 (C), new pc = mod12(9+6)=3. accidentalFor(C, pc3) =
    // mod12(3-natural(C)=0+6)-6 = 3, i.e. C### — more than a double
    // accidental, unspellable. "Bad" is recognised-as-non-music exactly as the
    // earlier pass-through test establishes, so it must stay untouched too.
    const result = transposeText({
      text: "Gx Bad",
      by: { kind: "interval", interval: "augmented-fourth", direction: "up" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unspellable).toBe(1);
    expect(result.text).toBe("Gx Bad");
    // The joined text cannot tell „stayed put because it is not music" from
    // „stayed put because it could not be spelled" — both keep their source.
    // The segments can, and they are three DISTINCT kinds rather than an
    // absent spelling that means either of two things.
    expect(result.segments.map((s) => s.kind)).toEqual(["unspellable", "prose", "prose"]);
  });

  it("names each segment by what became of it: a chord carries its new spelling, prose carries none", () => {
    const result = transposeText({
      text: "C | Bad",
      by: { kind: "interval", interval: "major-second", direction: "up" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // „C", „ ", „|", „ ", „Bad" — the split keeps the layout, so the two runs
    // of whitespace and the bar line are segments of their own.
    expect(result.segments.map((s) => s.kind)).toEqual([
      "chord",
      "prose",
      "prose",
      "prose",
      "prose",
    ]);
    const first = result.segments[0];
    expect(first?.kind).toBe("chord");
    if (first?.kind !== "chord") return;
    expect(first.transposed).toBe("D");
    expect(first.source).toBe("C");
  });

  it("refuses an unrecognised interval, instrument or direction in `by` rather than crashing or transposing the wrong way", () => {
    // INTERVALS[by.interval] would be undefined; spreading it into
    // ResolvedTransposition turns letterStep/semitones into NaN instead of
    // refusing, which is silently wrong rather than a crash.
    expect(
      transposeText({
        text: "C",
        by: { kind: "interval", interval: "tritone" as unknown as "unison", direction: "up" },
      }),
    ).toEqual({ ok: false, reason: "interval" });
    // `up: by.direction === "up"` silently treats anything but "up" as "down".
    expect(
      transposeText({
        text: "C",
        by: { kind: "interval", interval: "unison", direction: "sideways" as unknown as "up" },
      }),
    ).toEqual({ ok: false, reason: "direction" });
    // INSTRUMENT_TRANSPOSITION[by.instrument] would be undefined, and
    // resolveTransposition destructures it — a thrown TypeError, not a refusal.
    expect(
      transposeText({
        text: "C",
        by: {
          kind: "instrument",
          instrument: "c" as unknown as "bb",
          direction: "written-to-sounding",
        },
      }),
    ).toEqual({ ok: false, reason: "instrument" });
  });
});

describe("transposePitch", () => {
  it("an Eb sopranino clarinet's written D4 sounds F4 — a MINOR THIRD HIGHER, not the alto family's rule", () => {
    const result = transposePitch({
      name: "D4",
      by: { kind: "instrument", instrument: "eb-sopranino", direction: "written-to-sounding" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("F4");
    expect(result.midi).toBe(65);
  });

  it("the SAME written D4 on an Eb alto instrument sounds F3 — a major sixth LOWER, a full octave away", () => {
    const result = transposePitch({
      name: "D4",
      by: { kind: "instrument", instrument: "eb-alto", direction: "written-to-sounding" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("F3");
    expect(result.midi).toBe(53);
  });

  it("Cb4 stays written in octave 4 even though it sounds as B3 — the octave follows the SPELLING, not floor(midi/12)", () => {
    const result = transposePitch({
      name: "Cb4",
      by: { kind: "interval", interval: "unison", direction: "up" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("Cb4");
    expect(result.midi).toBe(59); // = B3, but still spelled and written as Cb4
  });

  it("refuses a malformed name and an out-of-range octave shift", () => {
    expect(
      transposePitch({ name: "H4", by: { kind: "interval", interval: "unison", direction: "up" } }),
    ).toEqual({ ok: false, reason: "name" });
    expect(
      transposePitch({
        name: "C4",
        by: { kind: "interval", interval: "unison", direction: "up" },
        octaveShift: 10,
      }),
    ).toEqual({ ok: false, reason: "octaveShift" });
  });

  it("refuses an unrecognised interval in `by` rather than crashing on an undefined pattern", () => {
    expect(
      transposePitch({
        name: "C4",
        by: { kind: "interval", interval: "ninth" as unknown as "unison", direction: "up" },
      }),
    ).toEqual({ ok: false, reason: "interval" });
  });
});

describe("transposeKey", () => {
  it("a Bb trumpet's written part in D major sounds in C major", () => {
    const result = transposeKey({
      tonic: "D",
      mode: "major",
      by: { kind: "instrument", instrument: "bb", direction: "written-to-sounding" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tonic).toBe("C");
  });

  it("a concert Eb major part written for Bb trumpet goes up a major second to F major", () => {
    const result = transposeKey({
      tonic: "Eb",
      mode: "major",
      by: { kind: "instrument", instrument: "bb", direction: "sounding-to-written" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tonic).toBe("F");
  });

  it("an F horn's written G major sounds in C major — a perfect fifth lower", () => {
    const result = transposeKey({
      tonic: "G",
      mode: "major",
      by: { kind: "instrument", instrument: "f", direction: "written-to-sounding" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tonic).toBe("C");
  });

  it("a tritone up from C has two equally valid spellings, and the preference picks between them", () => {
    const bySource = transposeKey({
      tonic: "C",
      mode: "major",
      by: { kind: "interval", interval: "augmented-fourth", direction: "up" },
    });
    expect(bySource.ok).toBe(true);
    if (bySource.ok) expect(bySource.tonic).toBe("F#");

    const byFlats = transposeKey({
      tonic: "C",
      mode: "major",
      by: { kind: "interval", interval: "augmented-fourth", direction: "up" },
      enharmonicPreference: "flats",
    });
    expect(byFlats.ok).toBe(true);
    if (!byFlats.ok) return;
    expect(byFlats.tonic).toBe("Gb");
    expect(byFlats.signature).toEqual({ sharps: 0, flats: 6, mixed: false });
  });

  it("a white-key result is unaffected by the enharmonic preference — there is no ambiguity to resolve", () => {
    const result = transposeKey({
      tonic: "C",
      mode: "major",
      by: { kind: "interval", interval: "perfect-fifth", direction: "up" },
      enharmonicPreference: "flats",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tonic).toBe("G");
  });

  it("refuses a malformed tonic", () => {
    expect(
      transposeKey({
        tonic: "Z",
        mode: "major",
        by: { kind: "interval", interval: "unison", direction: "up" },
      }),
    ).toEqual({ ok: false, reason: "tonic" });
  });

  it("refuses an unrecognised mode rather than silently treating it as minor", () => {
    // `input.mode === "major" ? "major" : "natural-minor"` would otherwise fold
    // any third option into minor without ever refusing it.
    expect(
      transposeKey({
        tonic: "C",
        mode: "dorian" as unknown as "major",
        by: { kind: "interval", interval: "unison", direction: "up" },
      }),
    ).toEqual({ ok: false, reason: "mode" });
  });

  it("refuses an unrecognised instrument in `by` rather than throwing on a destructure of undefined", () => {
    expect(
      transposeKey({
        tonic: "C",
        mode: "major",
        by: {
          kind: "instrument",
          instrument: "clarinet" as unknown as "bb",
          direction: "written-to-sounding",
        },
      }),
    ).toEqual({ ok: false, reason: "instrument" });
  });

  it("refuses an unrecognised enharmonicPreference rather than silently reading it as flats", () => {
    // `preference === "sharps" ? pair.sharp : pair.flat` would otherwise fold
    // any third option into "flats" without ever refusing it.
    expect(
      transposeKey({
        tonic: "C",
        mode: "major",
        by: { kind: "interval", interval: "augmented-fourth", direction: "up" },
        enharmonicPreference: "neutral" as unknown as "sharps",
      }),
    ).toEqual({ ok: false, reason: "enharmonicPreference" });
  });
});

/**
 * All three room-acoustics tools default the air temperature to 20 °C, and two
 * of their surfaces restated that 20 beside the echo. See
 * `ShelfSpacingResult.rasterUsed`: the calculation reports the value it used.
 *
 * The speed of sound is `331.3 * sqrt(1 + t/273.15)`, so 20 °C is
 * `331.3 * sqrt(1.0732198) = 343.2146 m/s` — the constant every other test in
 * this file is written against, which is what makes it the right thing to pin
 * the reported temperature to.
 */
describe("the resolved air temperature is returned rather than restated", () => {
  const uniform = (area: number, alpha: number) => ({
    area,
    alpha125: alpha,
    alpha250: alpha,
    alpha500: alpha,
    alpha1000: alpha,
    alpha2000: alpha,
    alpha4000: alpha,
  });

  it("soundWavelength reports 20 °C by default and the temperature given otherwise", () => {
    const defaulted = soundWavelength({ entry: { kind: "frequency", value: 100 } });
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.temperatureUsed).toBe(20);
    expect(defaulted.speedOfSound).toBeCloseTo(343.2146, 4);

    const explicit = soundWavelength({ entry: { kind: "frequency", value: 100 }, temperature: 0 });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.temperatureUsed).toBe(0);
    expect(explicit.speedOfSound).toBeCloseTo(331.3, 10);
  });

  it("soundWavelength reports NO temperature when the speed was given directly", () => {
    // The one case the old surface got visibly wrong: it printed „20 °C" beside
    // a speed the user had measured themselves, which no temperature produced.
    const overridden = soundWavelength({
      entry: { kind: "frequency", value: 100 },
      speedOverride: 350,
    });
    expect(overridden.ok).toBe(true);
    if (!overridden.ok) return;
    expect(overridden.temperatureUsed).toBeUndefined();
    expect(overridden.speedOfSound).toBe(350);
    expect(overridden.wavelength).toBeCloseTo(3.5, 12);
  });

  it("reverbTime reports the temperature it used", () => {
    const base = { volume: 100, surfaces: [uniform(100, 0.2)] };

    const defaulted = reverbTime(base);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.temperatureUsed).toBe(20);
    expect(defaulted.speedOfSound).toBeCloseTo(343.2146, 4);
    // Same answer as the explicit-20 case above it in this file, which is the
    // point: the default and the stated value are one number, not two.
    expect(defaulted.bands[0]?.sabine).toBeCloseTo(0.805, 3);

    const explicit = reverbTime({ ...base, temperature: 0 });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.temperatureUsed).toBe(0);
    expect(explicit.speedOfSound).toBeCloseTo(331.3, 10);
  });

  it("roomModes reports the temperature it used", () => {
    const base = { length: 5, width: 4, height: 2.8, frequencyLimit: 100 } as const;

    const defaulted = roomModes(base);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.temperatureUsed).toBe(20);
    // f(1,0,0) = c/2L = 343.2146/10.
    expect(defaulted.modes.find((m) => m.p === 1 && m.q === 0 && m.r === 0)?.frequency).toBeCloseTo(
      34.32146,
      4,
    );

    const explicit = roomModes({ ...base, temperature: 0 });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.temperatureUsed).toBe(0);
    expect(explicit.modes.find((m) => m.p === 1 && m.q === 0 && m.r === 0)?.frequency).toBeCloseTo(
      33.13,
      10,
    );
  });
});

/**
 * `referencePitch` defaults to 440 Hz, and the pitch surface restated that 440
 * beside its echo. See `ShelfSpacingResult.rasterUsed`.
 *
 * This one is not a rounding detail: every frequency the tool prints is directly
 * proportional to the reference, and 440 is a convention rather than a fact — a
 * house orchestra at 442 and a baroque ensemble at 415 both type their own, and
 * those are the users who look at this field at all.
 *
 * It is set inside `describeMidi`, which is the one function every pitch in this
 * module is built by, so the three entry points and the shifted pitch cannot
 * disagree about it. That is what the last two cases here are for.
 */
describe("the resolved tuning reference is returned rather than restated", () => {
  it("midiToPitch reports 440 by default, and the reference given otherwise", () => {
    const defaulted = midiToPitch({ midi: 69 });
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.referencePitchUsed).toBe(440);
    // A4 IS the reference, so the two numbers are the same one at every setting.
    expect(defaulted.frequency).toBeCloseTo(440, 12);

    const baroque = midiToPitch({ midi: 69, referencePitch: 415 });
    expect(baroque.ok).toBe(true);
    if (!baroque.ok) return;
    expect(baroque.referencePitchUsed).toBe(415);
    expect(baroque.frequency).toBeCloseTo(415, 12);
  });

  it("pitchFromName reports it too", () => {
    const defaulted = pitchFromName({ name: "A4" });
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.referencePitchUsed).toBe(440);

    const sharp = pitchFromName({ name: "A4", referencePitch: 442 });
    expect(sharp.ok).toBe(true);
    if (!sharp.ok) return;
    expect(sharp.referencePitchUsed).toBe(442);
    expect(sharp.frequency).toBeCloseTo(442, 12);
  });

  it("pitchFromFrequency reports it, and the cents reading is measured against it", () => {
    const measured = pitchFromFrequency({ frequency: 440, referencePitch: 442 });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(measured.referencePitchUsed).toBe(442);
    // 440 Hz is A4 read against a 442 reference, so it is FLAT by
    // 1200*log2(440/442) cents. 440/442 = 220/221, ln(1 - 1/221) = -0.00453516
    // to eight places, /ln2 = -0.00654284, x1200 = -7.851414. That is the whole
    // reading of the tool, and it is nonsense unless the screen says which
    // reference it was taken from.
    expect(measured.midiExact).toBeCloseTo(68.9214858, 6);
    expect(measured.cents).toBeCloseTo(-7.851414, 5);
    // `frequency` is the nearest NOTE's frequency, which at 442 is 442.
    expect(measured.frequency).toBeCloseTo(442, 12);
  });

  it("the shifted pitch carries the same reference, not a second copy of the default", () => {
    // `shifted` is built by `nearestPitchOf` on a different code path from the
    // pitch itself. An octave up from A4 at 415 is 830, and if the shift had
    // picked the default back up it would be 880.
    const shifted = midiToPitch({ midi: 69, referencePitch: 415, pitchShiftCents: 1200 });
    expect(shifted.ok).toBe(true);
    if (!shifted.ok) return;
    expect(shifted.shifted?.referencePitchUsed).toBe(415);
    expect(shifted.shifted?.frequency).toBeCloseTo(830, 9);
    expect(shifted.shifted?.midi).toBe(81);
  });
});
