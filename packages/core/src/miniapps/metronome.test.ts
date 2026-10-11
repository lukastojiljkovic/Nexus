import { describe, expect, it } from "vitest";
import {
  beatSchedule,
  tapTempo,
  tempoTrainerPlan,
  type MetronomeSpec,
} from "./metronome.js";

/**
 * 120 BPM in 4/4 with two subdivisions per beat, beat 3 muted. One grid
 * position every 0.25 s (60 / (120 x 2)) and eight per bar, so a bar is 2 s.
 */
const eighthGrid: MetronomeSpec = {
  startSeconds: 0,
  bpm: 120,
  beatsPerBar: 4,
  noteValue: 4,
  accents: ["strong", "weak", "off", "weak"],
  subdivisions: 2,
};

const timesOf = (spec: MetronomeSpec, from: number, to: number) =>
  beatSchedule(spec, from, to).map((click) => click.timeSeconds);

describe("beatSchedule", () => {
  it("walks one bar of the grid, numbering bars, beats and subdivisions", () => {
    const clicks = beatSchedule(eighthGrid, 0, 2);

    // Bar 1 is 2 s long and holds eight positions; beat 3 is muted, so its two
    // positions (1.00 s and 1.25 s) are absent.
    expect(clicks.map((click) => click.timeSeconds)).toEqual([0, 0.25, 0.5, 0.75, 1.5, 1.75]);
    expect(clicks.map((click) => click.bar)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(clicks.map((click) => click.beat)).toEqual([1, 1, 2, 2, 4, 4]);
    expect(clicks.map((click) => click.subdivision)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(clicks.map((click) => click.accent)).toEqual([
      "strong",
      "strong",
      "weak",
      "weak",
      "weak",
      "weak",
    ]);
    expect(clicks.map((click) => click.onBeat)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("restarts the accent pattern and numbers the bar on the next bar", () => {
    const second = beatSchedule(eighthGrid, 2, 4);
    expect(second.map((click) => click.bar)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(second.map((click) => click.beat)).toEqual([1, 1, 2, 2, 4, 4]);
    expect(second.map((click) => click.timeSeconds)).toEqual([2, 2.25, 2.5, 2.75, 3.5, 3.75]);
  });

  it("offsets the whole grid from the start time", () => {
    const spec: MetronomeSpec = { ...eighthGrid, startSeconds: 0.3, subdivisions: 1 };
    // Beats 0.5 s apart from 0.3 s: 0.3, 0.8, 1.3, ... so [0, 1) holds two.
    expect(timesOf(spec, 0, 1)).toEqual([0.3, 0.8]);
  });

  it("joins adjacent windows without a gap or a repeat", () => {
    const whole = beatSchedule(eighthGrid, 0, 4);
    const joined = [
      ...beatSchedule(eighthGrid, 0, 0.75),
      ...beatSchedule(eighthGrid, 0.75, 1.5),
      ...beatSchedule(eighthGrid, 1.5, 2.5),
      ...beatSchedule(eighthGrid, 2.5, 4),
    ];
    expect(joined).toEqual(whole);
    expect(new Set(joined.map((click) => click.timeSeconds)).size).toBe(joined.length);
  });

  it("joins adjacent windows whose grid interval is not a binary fraction", () => {
    // 100 BPM with three subdivisions: one position every 0.2 s (60 / 300).
    const spec: MetronomeSpec = {
      startSeconds: 0,
      bpm: 100,
      beatsPerBar: 4,
      noteValue: 4,
      accents: ["strong", "weak", "weak", "weak"],
      subdivisions: 3,
    };
    const whole = beatSchedule(spec, 0, 4.1);
    const joined = [
      ...beatSchedule(spec, 0, 1.3),
      ...beatSchedule(spec, 1.3, 2.6),
      ...beatSchedule(spec, 2.6, 4.1),
    ];
    expect(joined).toEqual(whole);
    expect(whole.length).toBe(21); // positions 0.0 s to 4.0 s inclusive
    expect(whole[20]?.timeSeconds).toBeCloseTo(4, 9);
  });

  it("includes a click exactly at the window start and excludes one at the end", () => {
    expect(timesOf(eighthGrid, 0, 0.5)).toEqual([0, 0.25]);
    expect(timesOf(eighthGrid, 0.5, 0.75)).toEqual([0.5]);
    expect(timesOf(eighthGrid, 0.75, 0.75)).toEqual([]);
  });

  it("never emits a click before the start time, however wide the window is", () => {
    expect(timesOf(eighthGrid, -2, 0)).toEqual([]);
    expect(timesOf(eighthGrid, -2, 0.6)).toEqual([0, 0.25, 0.5]);
  });

  it("refuses a tempo, signature, accent list or subdivision count out of range", () => {
    expect(() => beatSchedule({ ...eighthGrid, bpm: 19 }, 0, 1)).toThrow(RangeError);
    expect(() => beatSchedule({ ...eighthGrid, bpm: 401 }, 0, 1)).toThrow(RangeError);
    expect(() => beatSchedule({ ...eighthGrid, beatsPerBar: 0 }, 0, 1)).toThrow(RangeError);
    expect(() => beatSchedule({ ...eighthGrid, beatsPerBar: 17 }, 0, 1)).toThrow(RangeError);
    expect(() =>
      beatSchedule({ ...eighthGrid, noteValue: 3 as unknown as 4 }, 0, 1),
    ).toThrow(RangeError);
    expect(() => beatSchedule({ ...eighthGrid, subdivisions: 0 }, 0, 1)).toThrow(RangeError);
    expect(() => beatSchedule({ ...eighthGrid, subdivisions: 5 }, 0, 1)).toThrow(RangeError);
    expect(() => beatSchedule({ ...eighthGrid, accents: ["strong", "weak"] }, 0, 1)).toThrow(
      RangeError,
    );
  });
});

describe("tempoTrainerPlan", () => {
  it("steps the tempo in even jumps, each held for the given number of bars", () => {
    const plan = tempoTrainerPlan({ startBpm: 60, endBpm: 120, step: 20, barsPerStep: 4 });
    expect(plan.steps.map((step) => step.bpm)).toEqual([60, 80, 100, 120]);
    expect(plan.steps.map((step) => step.fromBar)).toEqual([0, 4, 8, 12]);
    expect(plan.steps.map((step) => step.bars)).toEqual([4, 4, 4, 4]);
    expect(plan.totalBars).toBe(16);
  });

  it("lands the last step on the target instead of overshooting it", () => {
    // 60 -> 110 with a step of 30: 60, 90, then the remainder 20 to reach 110.
    const plan = tempoTrainerPlan({ startBpm: 60, endBpm: 110, step: 30, barsPerStep: 2 });
    expect(plan.steps.map((step) => step.bpm)).toEqual([60, 90, 110]);
    expect(plan.totalBars).toBe(6);
  });

  it("walks downwards when the target is slower than the start", () => {
    const plan = tempoTrainerPlan({ startBpm: 120, endBpm: 90, step: 10, barsPerStep: 1 });
    expect(plan.steps.map((step) => step.bpm)).toEqual([120, 110, 100, 90]);
    expect(plan.totalBars).toBe(4);
  });

  it("is a single step when the two tempos are equal", () => {
    const plan = tempoTrainerPlan({ startBpm: 100, endBpm: 100, step: 10, barsPerStep: 3 });
    expect(plan.steps.map((step) => step.bpm)).toEqual([100]);
    expect(plan.totalBars).toBe(3);
  });

  it("refuses times outside the metronome's range or a step below one BPM", () => {
    expect(() =>
      tempoTrainerPlan({ startBpm: 10, endBpm: 120, step: 10, barsPerStep: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      tempoTrainerPlan({ startBpm: 60, endBpm: 401, step: 10, barsPerStep: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      tempoTrainerPlan({ startBpm: 60, endBpm: 120, step: 0, barsPerStep: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      tempoTrainerPlan({ startBpm: 60, endBpm: 120, step: 10, barsPerStep: 0 }),
    ).toThrow(RangeError);
  });
});

describe("tapTempo", () => {
  it("takes the median of the jittered intervals, not their average", () => {
    // Taps at 0, 0.50, 1.01, 1.50, 2.02 s: intervals 0.50, 0.51, 0.49, 0.52.
    // Sorted: 0.49, 0.50, 0.51, 0.52 -> median (0.50 + 0.51) / 2 = 0.505 s,
    // so 60 / 0.505 = 118.8118811881188... BPM.
    const result = tapTempo([0, 0.5, 1.01, 1.5, 2.02]);
    expect(result.taps).toBe(5);
    expect(result.intervals).toBe(4);
    expect(result.intervalSeconds).toBeCloseTo(0.505, 12);
    expect(result.bpm).toBeCloseTo(60 / 0.505, 9);
    expect(result.withinMetronomeRange).toBe(true);
  });

  it("drops everything before a gap longer than two seconds", () => {
    // The 3 s gap between 1.0 s and 4.0 s resets the reading: only the last two
    // taps count, and 0.6 s between them is exactly 100 BPM.
    const result = tapTempo([0, 0.5, 1.0, 4.0, 4.6]);
    expect(result.taps).toBe(2);
    expect(result.intervals).toBe(1);
    expect(result.intervalSeconds).toBeCloseTo(0.6, 12);
    expect(result.bpm).toBeCloseTo(100, 9);
  });

  it("keeps a gap of exactly two seconds, which is not longer than two", () => {
    // 0, 2.0, 2.5 s: no reset, intervals 2.0 and 0.5, median 1.25 s -> 48 BPM.
    const result = tapTempo([0, 2.0, 2.5]);
    expect(result.taps).toBe(3);
    expect(result.intervalSeconds).toBeCloseTo(1.25, 12);
    expect(result.bpm).toBeCloseTo(48, 9);
  });

  it("has no reading at all from fewer than two taps", () => {
    expect(tapTempo([])).toEqual({
      bpm: null,
      intervalSeconds: null,
      taps: 0,
      intervals: 0,
      withinMetronomeRange: false,
    });
    expect(tapTempo([1.5]).bpm).toBeNull();
  });

  it("flags a reading the metronome itself would refuse", () => {
    // 0.2 s between taps is 300 BPM (usable); 0.1 s is 600 BPM (refused).
    expect(tapTempo([0, 0.2, 0.4]).withinMetronomeRange).toBe(true);
    const tooFast = tapTempo([0, 0.1, 0.2]);
    expect(tooFast.bpm).toBeCloseTo(600, 9);
    expect(tooFast.withinMetronomeRange).toBe(false);
  });

  it("refuses timestamps that do not strictly increase", () => {
    expect(() => tapTempo([0, 0.5, 0.5])).toThrow(RangeError);
    expect(() => tapTempo([0, 0.5, 0.4])).toThrow(RangeError);
  });
});
